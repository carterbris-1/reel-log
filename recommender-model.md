# Reel Log "For You" Recommender: Model and Data Design
> The math and file formats behind [recommender-spec.md](recommender-spec.md): how prep builds
> the vectors, how the browser worker scores and picks, and how the monthly job extends it.
> The constants here are the tunable ones; the spec's requirements are not.

## 1. Prep pipeline (`recommender/prep.py`)

Run as `recommender/.venv/bin/python recommender/prep.py --stage {join,embed,vectors,all}`
(`extras` is task 7, not built yet).
Each stage reads the previous stage's parquet from `recommender/work/` (git-ignored), so a
failed stage reruns alone. Logs from the first run (2026-10-02) are quoted below.

**Stage `join`** → `work/joined.parquet` (~15 min, network-bound)
1. Download `ml-25m.zip` (~250 MB), extract the 3 CSVs used into `recommender/cache/`,
   and delete the zip. The HF dataset (`remsky/…`, one 7 GB parquet, 1,035,695 rows) is
   **streamed** over HTTP and never saved: it's a single row group, so pyarrow reads it
   page by page (`pre_buffer=False`). Loading it whole would need ~10 GB of RAM.
2. Stop if `id`, `vote_count`, `embedding`, or `title_tagline_overview` is missing.
3. Filter each 4,096-row batch to `vote_count >= 200` as it arrives.
4. Parse `embedding` (`"[0.1, …]"`), dropping rows that fail or aren't 768 long.
5. Join MovieLens `links.csv` on `tmdbId`, falling back to `imdbId`. Attach the pivoted
   genome (1,128 floats) where one exists; if two TMDB ids share a MovieLens movie, only
   the more-voted keeps it.

*Log:* `rows=12,989 genome=8,482 (65%) parse_failed=0 dupes=0`. No 2020+ film has genome.

**Stage `embed`** → `work/embedded.parquet`, `work/embed_format.json` (~4 min on M-series MPS)

Re-embeds every film's `title_tagline_overview` with `nomic-ai/nomic-embed-text-v1.5`
(revision pinned) through `sentence-transformers`, no prefix, normalised. The text is
`"{title}: {tagline}: {overview}"`, keeping the empty middle when there's no tagline.

*Why:* the HF vectors use two formats. The early rows (mostly older, popular films) embed
the raw text; later rows had genres appended. Measured on 400 films: raw text reproduces
the first group at cosine 1.000, but the second only with genres added (0.990). After
centring, that genre text dominated: the second group (which is also the no-genome group)
had nearest-neighbour similarity 0.95 vs 0.68, and 95% of its neighbours were each other.
*Log:* `cosine to the HF vectors: genome films 1.000, others 0.989`.

**Stage `vectors`** → `out/vectors.i8`, `out/catalogue.json`, `out/manifest.json`
1. **Genome block** `G`: subtract the per-tag mean over genome films, L2-normalise. Without
   centring every pair scores ~0.8 (spec §5.1).
2. **Plot block** `P`: subtract the per-dim mean, L2-normalise.
3. **Imputation (kNN):** for films with no genome, a softmax-weighted (temperature 0.05)
   mean of the genome blocks of the **5** genome films closest by `[P, genre_onehot(19)]`,
   then normalised. Saved as `genome_knn.npz` (reference features + blocks, float16) so
   the monthly job imputes against the same set.
4. **Combine:** `x = normalise([0.6·g, 0.4·p])` (1,896-d), the same weights for every film.
5. **PCA to 256-d** (randomized, seed 0), re-normalised; saved to `pca.npz`. Judged by
   **top-10 neighbour recall** against the 1,896-d space (must be ≥ 0.80), not variance.
6. **Quantise:** `s = 127 / max|Z|`, `q = round(Z·s)`. A fixed `s = 127` would round most
   entries to 0 or ±1. `manifest.scale = 1/s`.
7. **Checks:** print the share of imputed films among each group's neighbours, and the 10
   nearest titles to *Inception*, *Alien*, *Toy Story*, *Dune* (2021), and *Oppenheimer*.

*Log:*
```text
genome imputation (kNN k=5), held out: mean cosine to the real block=0.477
imputed share: catalogue 35%, neighbours of genome films 41%, neighbours of imputed films 63%
PCA 1896→256: 80.8% of variance, top-10 neighbour recall 0.84
int8 scale=0.00613, worst self-cosine error over 500 rows=0.0005
nearest to Dune: Dune (0.89); Dune: Part Two (0.67); … John Carter (0.63); 2010 (0.63) …
nearest to Oppenheimer: Munich: The Edge of War (0.79); … Conspiracy (0.75); Schindler's List (0.74) …
```

**Alternatives measured and rejected** (imputed share among neighbours of genome / imputed films):

| Choice | Result | Why rejected |
|---|---|---|
| Ridge imputation (α=10) | 22% / 89% | Predictions are smooth averages, so imputed films clump |
| Imputed films weighted 0.4 genome / 0.6 plot | 2–5% / 37–53% | Mismatched weights push the two groups apart |
| kNN k=20 or k=50 | 39% / 73–90% | More averaging, more clumping; held-out cosine barely better |
| PCA 320-d / 384-d | recall 0.86 / 0.88 | +27% / +52% download for +0.02 / +0.04 recall |
| int8 scale at 99.9th percentile | worst pair error 0.13 | Clips the top PCA components; max-abs gives 0.008 |

**Stage `extras`** → artsy scores, `main` flags, `onboarding.json`
- **Artsy:** for genome movies, the mean relevance (raw, not centred) of the tag set in spec
  §5.2, min–max scaled to 0–1 over the catalogue. Assert every tag name exists. For the
  rest, `Ridge(alpha=1)` on the 256-d vector predicts it (saved `artsy_ridge.npz`, held-out
  R² printed). Then the director boost: directors (from HF `crew`/`director` field, or TMDB
  `/credits` if absent) with ≥ 2 genome films averaging ≥ 0.7 add +0.1 to their non-genome
  films, capped at 1. Stored as `uint8 = round(artsy·255)`.
- **`main`:** genres ∩ {Comedy, Action, Thriller, Adventure, Science Fiction} non-empty and
  `vote_count` ≥ the catalogue's 80th percentile.
- **Onboarding:** `KMeans(15, n_init=10, random_state=0)` on the 3,000 most-voted vectors;
  pick the most-voted movie per cluster. Print the 15 titles for a human check.

## 2. Published file formats

```text
manifest.json   { "version": "2026-10-ac759f25", "count": 12989, "dims": 256, "scale": 0.00613,
                  "genres": ["Action", "Adventure", … 19 names],
                  "files": { "vectors": "vectors.i8", "catalogue": "catalogue.json" },
                  "bytes": { "vectors": 3325184, "catalogue": 1345390 } }
vectors.i8      count × 256 int8, row-major. Row i belongs to catalogue index i.
catalogue.json  { "tmdb": [27205, ...], "title": [...], "year": [2010, ...],
                  "genres": [uint32 bitmask], "pop": [...], "votes": [...],
                  "rating": [...], "poster": ["/abc.jpg" | null], "genome": [0|1],
                  "director": [str|null],
                  "artsy": [0..255], "main": [0|1] }      ← these two added by `extras`
onboarding.json [tmdb_id × 15]
```

`version` is the month plus the first 8 hex digits of a SHA-256 over the published bytes, so
any change to the data changes it, and an identical rebuild in the same month keeps it. The browser caches
by version, and the release is tagged `data-<version>`. `files` lists only files that
exist: the deploy copies exactly these and fails if one is missing. `extras` (task 7) adds
`onboarding` and recomputes the version.

Bit i of `genres` is `manifest.genres[i]` (TMDB's `/genre/movie/list` order), so the
client never hard-codes the list. That needs 19 bits, so `uint16` would not fit. Arrays
are columnar because JSON repeats keys per object; booleans are 0/1 to save bytes.

## 3. Worker (`src/rec/worker.ts` + `src/rec/model.ts`)

**Load.** On `init`, fetch `data/manifest.json` with `cache: "no-store"`. Open Cache Storage
`reel-rec-<version>`; on a miss, stream each file with a `ReadableStream` reader and post
`progress` from `manifest.bytes`. Delete any other `reel-rec-*` cache after success. If
`caches` is unavailable, fetch directly. Then compute `inv[i] = 1/‖q_i‖` once (Float32Array).

**State.**
```ts
type VoteCol = { idx: number; thumb: 1 | -1; sims: Int8Array }; // sims[i] = 127·cos(i, voted)
interface ModelState {
  vecs: Int8Array; inv: Float32Array; n: number; cols: Map<number, VoteCol>;
  w?: Float32Array; b?: number;
}
```

**Similarity.** `sim(i, j) = (q_i · q_j) · inv[i] · inv[j]`, which is cos(i, j) up to
quantisation error (< 0.01 at s from §1.6). A vote's column is
`col[i] = round(127 · sim(i, v))` for all i: 13k × 256 int8 multiply-adds, ~3–8 ms.

**kNN term** (for every unvoted i, over the columns):
```text
like(i)    = mean of the top k sims to 👍 movies, k = min(5, #👍)       (0 if no 👍)
penalty(i) = λ · max over 👎 j of max(0, (sim(i,j) − τ) / (1 − τ))      τ = 0.55, λ = 0.5
knn(i)     = like(i) − penalty(i)
```
`max`, not sum, so ten 👎 on similar films don't bury a whole region harder than one does.
Top-k is a running 5-slot insertion sort per row: N × votes reads, no allocation.

**Logistic regression** (from 30 votes with ≥ 5 of each thumb):
- Features: dequantised rows `x_i = q_i · inv[i]` (unit vectors), label 1 for 👍, 0 for 👎.
- Loss: class-weighted log loss (weights `n/(2·n_class)`) + `0.01‖w‖²`. Plain batch
  gradient descent, step 0.5, 200 iterations, warm-started from the previous `w, b`.
- Score: `lr(i) = w · x_i + b` for every unvoted i (another 3.3M multiply-adds).

**Blend.** `z(·)` standardises over all unvoted movies (mean 0, sd 1).
`α = 0` below the logreg threshold, else `clamp(0.2 + 0.3·(votes − 30)/120, 0.2, 0.5)`.
`taste(i) = (1 − α)·z(knn)(i) + α·z(lr)(i)`. With zero 👍 (all-👎 onboarding),
`taste(i) = z(log(votes_i))` − penalty, i.e. popularity minus dislikes (spec risk 4).

**Slot ranking and picking.**

| Slot | Eligible when | Rank |
|---|---|---|
| Mainstream | `main[i]` | `taste + 0.3·[year ≥ thisYear − 10]` |
| Artsy | `artsy ≥ 153` (0.6), `rating ≥ 7.2`, `pop < median(pop)` | `taste` |
| Explore | `nov(i) ≤ p15(nov)`, `rating ≥ 7.0`, `votes ≥ 500` | `rating`, uniform pick from top 20 |

`nov(i)` = the max sim from i to any voted movie (either thumb), so low means unlike
anything you've judged. Every slot also excludes: voted movies, movies in cooldown, and
movies with sim > 0.85 to a card already on screen (computed directly, 4 × 256 ops).
Mainstream and artsy pick from their top 10 with weight `1/(rank+1)`, so a refresh varies
even when votes haven't changed. If a pool empties, relax in this order and log it: drop
the popularity cap, lower artsy to 0.5, lower the rating floor by 0.3, then fall back to the
mainstream pool.

**Messages.** Every request carries an `id`; the reply echoes it.
```ts
type ToWorker =
  | { id: number; type: "init"; base: string }
  | { id: number; type: "setVotes"; votes: { tmdb: number; thumb: 1 | -1 }[] }
  | { id: number; type: "vote"; tmdb: number; thumb: 1 | -1 }       // add or flip
  | { id: number; type: "remove"; tmdb: number }
  | { id: number; type: "pick"; slots: Slot[]; onScreen: number[]; cooldown: number[];
      rewatch?: number };                                              // tmdb id for R12
type FromWorker =
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "ready"; version: string; count: number }
  | { id: number; type: "picks"; cards: { tmdb: number; slot: Slot; rewatch: boolean }[] }
  | { id: number; type: "error"; message: string };
type Slot = "mainstream" | "artsy" | "explore";
```
`vote`/`remove` update the model and retrain before replying, so the next `pick` already
sees the change. The main thread sends `vote` only after Supabase confirms the write.

## 4. Building the worker without a bundler

`tsconfig.json` includes the `DOM` lib, and the DOM and WebWorker libs conflict. So:
- `src/rec/model.ts` holds all the math. It uses no `window`, `self`, or DOM types, so it
  compiles under both configs and runs under Node for tests.
- `tsconfig.worker.json` extends the main one with `lib: ["ES2022", "WebWorker"]` and
  `include: ["src/rec/worker.ts", "src/rec/model.ts"]`. The main config excludes
  `src/rec/worker.ts`.
- `npm run build` becomes `tsc && tsc -p tsconfig.worker.json`.
- `src/rec/client.ts` (main thread) starts it with
  `new Worker(new URL("./worker.js?v=N", import.meta.url), { type: "module" })`, with N
  bumped alongside the `?v=` in `index.html`. Module workers need iOS 15+.
- Tests: `src/rec/model.test.ts` uses `node:test`, compiled with its own
  `tsconfig.test.json` (adds `@types/node`), run by `npm test` →
  `node --test js/rec/*.test.js`. `deploy.yml` deletes `js/**/*.test.js` before upload.

## 5. Monthly update (`recommender/update.py`)

1. Load `pca.npz`, `genome_knn.npz`, `artsy_ridge.npz`, `embed_format.json`, and the
   previous release's catalogue and vectors (`gh release download`).
2. `/discover/movie` with `primary_release_date.gte` = the last run's date,
   `vote_count.gte=50`, sorted by `primary_release_date.asc`, paging until done (TMDB caps
   at 500 pages; one month is far below that). Skip ids already in the catalogue.
3. For each new movie, `/movie/{id}?append_to_response=credits` for tagline, overview,
   genres, and director. Build the text exactly as `embed_format.json` says, embed it with
   the same pinned model, then run §1's steps: centre with the *saved* plot mean, kNN-impute
   against the *saved* reference set, weight, project with the *saved* PCA, and quantise
   with the *saved* scale, clipping to ±127. Never refit.
4. Refresh `pop`, `votes`, and `rating` for movies released in the last 2 years
   (~5k calls at ≤ 40 req/s ≈ 2–3 min).
5. Drop movies that are 12+ months old with `votes < 200` (spec §5.5). Rows shift, which
   is fine: votes are keyed by `tmdb_id` and the worker rebuilds columns per version.
6. Write the files, `gh release create data-<version> out/* recommender/work/*.npz`, then
   `gh workflow run deploy.yml`. A release made with `GITHUB_TOKEN` does **not** trigger
   other workflows on its own, so the explicit dispatch is required.

**Embedding in CI.** `update.py` uses `sentence-transformers` with the same pinned revision
(no Ollama), with the model cached by `actions/cache` (~550 MB). Runs on CPU: a month's
~100–300 new films take well under a minute. `transformers` is pinned below 5, because
nomic's remote model code calls an API that version 5 removed.
