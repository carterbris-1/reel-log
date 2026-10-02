# SCRATCH 2026-10-02: Recommender spec, data prep, and data plumbing (tasks 1, 2, 3, 15)

## Summary

The "For You" recommender spec was filled out into two files, and its first two tasks were
built and run. `recommender/prep.py` now turns the Hugging Face movie dataset and
MovieLens 25M into the three files the browser will load: `vectors.i8`, `catalogue.json`,
and `manifest.json`. Task 3 then added the `votes` table, its three `db.ts` functions,
and a deploy step that copies those files from a GitHub release into the site (see
"Task 3" at the end). No page uses any of it yet; that starts with task 5.

Building it turned up a real problem the spec hadn't foreseen. The HF plot vectors were
made in two different text formats, which split the catalogue into two groups that
barely recommended each other. Prep now re-embeds every film itself, which fixed it and
also made spec task 15 (embedding-format check) unnecessary.

**Change stats** (`change-percent.sh 3dc6800`): **21.0%**: 416 lines changed against a
1,981-line baseline (`.md` excluded from the count).

| | Files |
|---|---|
| Added | `recommender/prep.py` (409 lines), `recommender/requirements.txt` (10), `recommender-model.md` (222) |
| Changed | `recommender-spec.md` (was an untracked draft; now 298 lines), `.gitignore` (+7) |
| Deleted | none |
| Generated, git-ignored | `recommender/{.venv,cache,work,out}/` |

## How it fits together

```text
prep.py --stage join     HF parquet (7 GB, streamed) ─┐
                         MovieLens links + genome ────┴→ work/joined.parquet (12,989 films)
prep.py --stage embed    joined.parquet → nomic-embed-text-v1.5 → work/embedded.parquet
                                                            └→ work/embed_format.json
prep.py --stage vectors  embedded.parquet → centre → kNN-impute genome → combine
                         → PCA 256 → int8 → out/{vectors.i8, catalogue.json, manifest.json}
                                          └→ work/{pca.npz, genome_knn.npz}  (for update.py)
```

Later (task 3), `deploy.yml` copies `out/` into the site as `/data/`. The worker (task 5)
loads it and scores films against your 👍/👎 votes. `work/*.npz` and `embed_format.json`
let the monthly `update.py` (task 16) place new films in the same space without refitting.

## New files

### `recommender/prep.py`

The offline data builder. Nothing imports it; you run it by hand on your Mac. Each stage
reads the previous stage's file, so one can rerun alone.

**Streaming the 7 GB file.** It's a single parquet row group, so a normal read would pull
~10 GB into memory. Reading page by page keeps one 4,096-row batch in memory at a time:

```python
# recommender/prep.py:108-121
    fs = HfFileSystem()
    total = fs.info(HF_PATH)["size"]
    with fs.open(HF_PATH, "rb", block_size=32 * 2**20) as fh:
        pf = pq.ParquetFile(fh, buffer_size=8 * 2**20, pre_buffer=False)
        log(f"HF schema: {pf.schema_arrow.names}")
        missing = [c for c in HF_COLUMNS if c not in pf.schema_arrow.names]
        if missing:
            sys.exit(f"HF dataset is missing columns {missing}; adapt HF_COLUMNS")

        kept, seen, last = [], 0, 0.0
        for batch in pf.iter_batches(batch_size=4096, columns=HF_COLUMNS):
            df = pl.from_arrow(batch)
            seen += df.height
            kept.append(df.filter(pl.col("vote_count") >= MIN_VOTES))
```

**Re-embedding** with a pinned model revision:

```python
# recommender/prep.py:207-212
def embedder():
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return SentenceTransformer(EMBED_MODEL, revision=EMBED_REVISION, trust_remote_code=True, device=device)
```

**kNN genome imputation** for the 4,507 films MovieLens has no genome scores for:

```python
# recommender/prep.py:267-277
def knn_impute(query: np.ndarray, ref: np.ndarray, ref_genome: np.ndarray) -> np.ndarray:
    """Softmax-weighted mean of the genome blocks of the IMPUTE_K closest reference films."""
    out = np.empty((len(query), ref_genome.shape[1]), dtype=np.float32)
    for start in range(0, len(query), 1024):  # chunks keep the similarity matrix small
        sims = query[start:start + 1024] @ ref.T
        idx = np.argpartition(-sims, IMPUTE_K, axis=1)[:, :IMPUTE_K]
        top = np.take_along_axis(sims, idx, axis=1)
        w = np.exp((top - top.max(axis=1, keepdims=True)) / IMPUTE_TEMP)
        w /= w.sum(axis=1, keepdims=True)
        out[start:start + 1024] = np.einsum("nk,nkd->nd", w, ref_genome[idx])
    return normalise(out)
```

**PCA judged by neighbour recall, int8 scaled to the max:**

```python
# recommender/prep.py:335-351
    # PCA is judged by whether neighbours survive it, not by a variance target.
    pca = PCA(DIMS, svd_solver="randomized", random_state=0).fit(X)
    Z = normalise(pca.transform(X).astype(np.float32))
    truth = np.argsort(-sims, axis=1)[:, :10]
    zs = Z[sample] @ Z.T
    zs[np.arange(len(sample)), sample] = -2
    got = np.argsort(-zs, axis=1)[:, :10]
    recall = float(np.mean([len(set(a) & set(b)) / 10 for a, b in zip(truth, got)]))
    log(f"PCA {X.shape[1]}→{DIMS}: {pca.explained_variance_ratio_.sum():.1%} of variance, top-10 neighbour recall {recall:.2f}")
    if recall < MIN_PCA_RECALL:
        sys.exit(f"PCA top-10 recall {recall:.2f} < {MIN_PCA_RECALL}; raise DIMS")

    # A unit 256-d vector's entries average ~0.06, so scale by the data, not by 127.
    # Scaling to the largest entry (no clipping) beat the 99.9th percentile: clipping the
    # top PCA components pushed worst-case similarity error from 0.008 to 0.13.
    s = 127 / float(np.abs(Z).max())
    q = np.clip(np.rint(Z * s), -127, 127).astype(np.int8)
```

**Live examples** (actual output, run 2026-10-02):

```python
genre_mask(pl.Series(["Action, Science Fiction, Adventure"]))
# → bits [0, 1, 14] → bitmask 16387

# catalogue.json, Inception's row:
{'tmdb': 27205, 'title': 'Inception', 'year': 2010, 'genres': 16387, 'pop': 107.1,
 'votes': 36718, 'rating': 8.4, 'poster': '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg', 'genome': 1,
 'director': 'Christopher Nolan'}

# vectors.i8, Inception's row, first 8 of 256 int8 values:
[77, 51, 64, 11, -14, 24, -38, 37]

neighbours(q, inv, titles, row=<Inception>, k=3)
# → ['The Matrix (0.72)', 'Predestination (0.70)', 'Interstellar (0.70)']
```

Actual stage logs:

```text
[07:29:49] rows=12,989 genome=8,482 (65%) parse_failed=0 dupes=0 → …/joined.parquet (64 MB)
[07:29:49] check ok: Inception has plot[768] and genome[1128]
[07:50:54] cosine to the HF vectors: genome films 1.000, others 0.989
[07:53:39] genome imputation (kNN k=5), held out: mean cosine to the real block=0.477
[07:53:41] imputed share: catalogue 35%, neighbours of genome films 41%, neighbours of imputed films 63%
[07:53:44] PCA 1896→256: 80.8% of variance, top-10 neighbour recall 0.84
[07:53:44] int8 scale=0.00613, worst self-cosine error over 500 rows=0.0005
[07:53:45] wrote vectors.i8 (3.3 MB), catalogue.json (1.3 MB, 0.6 MB gzipped), manifest.json
[07:53:45] nearest to Alien: Alien: Romulus (0.90); Aliens (0.83); Forbidden Planet (0.75); District 9 (0.74); …
[07:53:45] nearest to Dune: Dune (0.89); Dune: Part Two (0.67); … John Carter (0.63); 2010 (0.63); …
[07:53:45] nearest to Oppenheimer: Munich: The Edge of War (0.79); … Schindler's List (0.74); …
```

### `recommender/requirements.txt`

Pinned versions installed into `recommender/.venv` (Python 3.12 via `uv`):

```text
einops==0.8.2
fsspec==2026.9.0
huggingface-hub==0.36.2
numpy==2.5.3
polars==1.44.2
pyarrow==25.0.1
scikit-learn==1.9.1
sentence-transformers==5.7.0
torch==2.14.1
transformers==4.57.6
```

`transformers` is held below 5 because nomic's model code calls
`get_extended_attention_mask`, which version 5 removed. With 5.18.0 the run failed with:
`AttributeError: 'NomicBertModel' object has no attribute 'get_extended_attention_mask'`.

### `recommender-model.md`

The technical companion to the spec: each prep stage with its real log, the alternatives
measured and rejected, file formats, scoring math, worker message protocol, the
no-bundler worker build, and the monthly update. It's split out so the main spec stays
under 300 lines.

## Changed files

### `recommender-spec.md`

It was an untracked draft at the baseline. The main changes:

- Before (R1): "downloads MovieLens 25M and the Hugging Face dataset … (1.04M rows, 768-d
  `nomic-embed-text` plot vectors)". After: "streams the Hugging Face dataset … re-embeds
  every plot with a pinned `nomic-embed-text-v1.5` (§5.3)". *Why:* the stored vectors are
  inconsistent (below).
- Before (§5.1): "Prep fits a Ridge model … If R² < 0.4, imputed movies lean on the plot
  block instead … PCA to 256-d (asserting ≥ 85% variance kept)". After: kNN (k=5)
  imputation, the same 0.6/0.4 weights for everyone, PCA checked by neighbour recall.
  *Why:* measured; see "How it was built".
- Before (§5.3): Ollama vs sentence-transformers format check. After: "Inconsistent
  embeddings", fixed by re-embedding all films.
- Sizes moved from 25k films to the measured 12,989 (3.3 MB of vectors, ~4–5 MB total).
- Your answers were recorded: licence = personal use (risk 2, ledger 20); one binary
  thumb per movie (ledger 8). A MovieLens credit line was added to R19.
- Tasks 1, 2, and 15 are marked ✅. Task 16 no longer depends on 15.

### `.gitignore`

```diff
+# Recommender prep: Python env, downloads, and intermediate/output data (published as releases)
+recommender/.venv/
+recommender/cache/
+recommender/work/
+recommender/out/
+__pycache__/
```

*Why:* the virtual environment (1.1 GB), the MovieLens CSVs (416 MB), and the data files
must never enter git. Data ships as GitHub release assets (spec §3).

## Deleted files

None. (A stale `work/genome_ridge.npz` from the first Ridge run was removed; it was
git-ignored and nothing reads it.)

## How it was built

1. **First attempt at reading the dataset looked frozen.** The parquet is one 6.5 GB row
   group, so a plain read buffers it all. The fix was `pre_buffer=False` plus a buffered
   stream (page-by-page reads), with progress logged every 15 s. The scan took ~15 min.
2. **The catalogue is 12,989 films, not ~25k.** Fewer TMDB films have 200+ votes than the
   spec assumed. MovieLens genome covers 65%, but **0%** of films from 2020 on.
3. **Ridge imputation (R² 0.32) made the no-genome films clump.** 95% of their neighbours
   were each other, at 0.95–0.99 similarity (*Dune* → *Cosmoball*, *Moonfall*).
4. **Diagnosis: the clumping was already in the plot vectors.** Before any imputation,
   no-genome films had nearest-neighbour similarity 0.95 vs 0.68 for the rest. I
   re-embedded 400 films under four text formats: raw text matched the genome-film group
   at cosine **1.000**, and the other group only when genres were appended (**0.990**). The
   dataset used two formats.
5. **Fix: re-embed all films** with raw text (210 s on MPS). Plot-only, both groups then
   showed the same neighbour similarity (0.41 / 0.41).
6. **Imputation re-tested on clean plots.** Measured as imputed share among neighbours of
   genome films / of imputed films: Ridge 22% / 89%, kNN k=20 39% / 73%, **kNN k=5 36% /
   59%** (chosen), and imputed-weight 0.4 2–5% (rejected: it splits the groups). The spec's
   "R² < 0.4 → shift weights" rule was removed for that reason.
7. **PCA threshold changed.** 256-d keeps 80.8% of variance (below the spec's 85%), but
   84% of top-10 neighbours. 320-d reached only 86% for a 27% larger download.
8. **Quantisation scale changed** from the 99.9th percentile to the max. Worst-case pair
   error fell from 0.128 to 0.008.

Experiment scripts lived in the session scratchpad and are not in the repo. Their results
are recorded in `recommender-model.md` §1.

## How to try it

From the repo root:

```bash
uv venv --python 3.12 recommender/.venv
VIRTUAL_ENV=recommender/.venv uv pip install -r recommender/requirements.txt
recommender/.venv/bin/python recommender/prep.py --stage join      # ~15 min, streams 7 GB
recommender/.venv/bin/python recommender/prep.py --stage embed     # ~4 min on Apple silicon
recommender/.venv/bin/python recommender/prep.py --stage vectors   # ~10 s
```

`--stage all` runs them in order. The `vectors` log ends with the nearest-neighbour lists
shown above. **iPhone:** nothing to try yet. The site doesn't load these files until tasks
3–6.

## Known limitations and follow-ups

- No-genome films still lean toward each other (63% of their neighbours vs a 35% share).
  That's partly real (recent films share themes), but worth watching once picks are live.
- Held-out imputation cosine is 0.48: imputed genome blocks are rough. They mostly steer
  "feel"; the plot block carries content.
- `trust_remote_code` runs nomic's downloaded Python. The model revision is pinned, but
  the remote code repo (`nomic-ai/nomic-bert-2048`) is not separately pinned.
- `DATA_VERSION` comes from the clock, so rerunning in November renames the release.
- `extras` (artsy score, `main` flag, onboarding) is task 7, not built yet. `catalogue.json`
  lacks `artsy`/`main` until then.
- The disk had 13 GB free after this work. The HF model cache (~523 MB) and `.venv` (1.1 GB)
  are the big items.
- Commits `84c16eb` (spec + prep) and `4cae719` (task 3) are local. They're not pushed yet,
  pending the push review.
- The `votes` table exists in `schema.sql` only until you run it in the Supabase SQL Editor.
- ~~`setVote` stamps `voted_at` with the device clock~~: fixed by a server trigger (see
  "Review fixes" at the end).
- The deploy step trusts whichever `data-*` release is newest by creation date. A release
  missing a listed file now fails the deploy (see "Review fixes"), but a release with
  wrong *content* would still go live.

---

# Task 3: votes table and data plumbing

## Summary

Task 3 connects the data from tasks 1–2 to the site, without a page using it yet:
- **`votes` table:** stores your 👍/👎, owner-only.
- **`db.ts`:** gains `getVotes()`, `setVote()` and `removeVote()`.
- **`deploy.yml`:** copies the newest `data-*` release's files into the site at `/data/`.
- **First release:** `data-2026-10` is published.

**Stats** (commit `4cae719`): 5 files changed, +89 / −1. That's 4.5% of the 1,981-line
baseline on its own. The 21% figure above already includes tasks 1–2.

| | Files |
|---|---|
| Changed | `supabase/schema.sql` (+19), `src/db.ts` (+23 −1), `src/types.ts` (+10), `.github/workflows/deploy.yml` (+25), `CODE_GUIDE.md` (+12) |
| Added / deleted | none |

## How it fits together

```text
prep.py → recommender/out/*  ──(gh release create, run by you)──►  release data-2026-10
push to main → deploy.yml: build → copy site files → "Add recommender data":
             newest data-* release → manifest.json, vectors.i8, catalogue.json
             (+ onboarding.json once task 7 makes it) → _site/data/ → GitHub Pages
later: worker (task 5) fetches /data/*  ·  For You (task 6) calls setVote → Supabase votes
```

## Changed files

### `supabase/schema.sql` (lines 45–62, appended)

```sql
create table if not exists public.votes (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  tmdb_id   int  not null,
  thumb     smallint not null check (thumb in (1, -1)),
  voted_at  timestamptz not null default now(),
  primary key (user_id, tmdb_id)
);

alter table public.votes enable row level security;

drop policy if exists "own votes" on public.votes;
create policy "own votes" on public.votes for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

*Why:* `votes` follows the same pattern as `lists`: `user_id` comes from the login, so the
browser can't fake it, and the RLS policy keeps the public anon key from reading anyone's
votes. The primary key `(user_id, tmdb_id)` enforces "one thumb per film", so a flip is
an upsert. The `check` enforces "a thumb, never a rating". **Not live** until it's run in
the Supabase SQL Editor.

### `src/types.ts` (lines 95–103, added)

```ts
/** 👍 = 1, 👎 = -1. A vote is never a rating, just one of these. */
export type Thumb = 1 | -1;

/** A row of `votes` (For You recommender): one per film you've judged. */
export interface Vote {
  tmdb_id: number;
  thumb: Thumb;
  voted_at: string;
}
```

### `src/db.ts` (lines 107–127 added, import on line 6 widened)

Before → after for the import:
```ts
import type { List, ListItem, ListMembership, Movie } from "./types.js";
```
```ts
import type { List, ListItem, ListMembership, Movie, Thumb, Vote } from "./types.js";
```

New functions, all through the existing `run()` helper (same error handling as lists):
```ts
/** Every 👍/👎, newest first (History page and the recommender's training set). */
export function getVotes(): Promise<Vote[]> {
  return run(client().from("votes").select("tmdb_id, thumb, voted_at").order("voted_at", { ascending: false }));
}

/** Vote, flip, or re-stamp (Rewatch). One row per film, so this is an upsert. */
export function setVote(tmdbId: number, thumb: Thumb): Promise<void> {
  return run(
    client().from("votes").upsert(
      { tmdb_id: tmdbId, thumb, voted_at: new Date().toISOString() },
      { onConflict: "user_id,tmdb_id" },
    ),
  );
}

/** Forget a vote, so the film can be recommended again. */
export function removeVote(tmdbId: number): Promise<void> {
  return run(client().from("votes").delete().eq("tmdb_id", tmdbId));
}
```

**Example** (*expected* output: these haven't run against Supabase yet, because the
table isn't created and no page calls them until task 6):
```ts
await setVote(27205, 1);   // 👍 Inception
await setVote(27205, -1);  // flip: same row, thumb becomes -1
await getVotes();          // → [{ tmdb_id: 27205, thumb: -1, voted_at: "2026-10-…" }]
await removeVote(27205);   // → getVotes() returns []
```

Verified: `npm run typecheck` and `npm run build` both pass.

### `.github/workflows/deploy.yml` (lines 45–68, new step after "Collect site files")

```yaml
      - name: Add recommender data
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          tag=$(gh release list --limit 100 --json tagName,publishedAt \
            --jq '[.[] | select(.tagName | startswith("data-"))] | sort_by(.publishedAt) | last | .tagName // empty')
          if [ -z "$tag" ]; then
            echo "No data-* release yet; For You will show its notice."
            exit 0
          fi
          assets=$(gh release view "$tag" --json assets --jq '.assets[].name')
          mkdir -p _site/data
          for f in manifest.json vectors.i8 catalogue.json onboarding.json; do
            if grep -qx "$f" <<<"$assets"; then
              gh release download "$tag" --dir _site/data --pattern "$f"
            fi
          done
          test -f _site/data/manifest.json || { echo "$tag has no manifest.json"; exit 1; }
          echo "Added $tag:"; ls -l _site/data
```

*Why:* the data files stay out of git (spec §3), so they're pulled from the release at
deploy time. Only the four served files are copied, by name. The prep-only `.npz` files
and `embed_format.json` stay in the release and never reach the website. No release →
skip, so deploys can't break (spec risk 6). `onboarding.json` doesn't exist until task 7,
so missing assets are skipped individually.

**Live test**: the step's script, extracted from the YAML and run locally with
`GH_REPO=carterbris-1/reel-log bash -e step.sh`:

Before the release existed (actual output):
```text
No data-* release yet; For You will show its notice.
exit=0
```
After the release (actual output):
```text
Added data-2026-10:
-rw-r--r--@ 1 kujo  wheel  1345390 Oct  2 08:19 catalogue.json
-rw-r--r--@ 1 kujo  wheel      585 Oct  2 08:19 manifest.json
-rw-r--r--@ 1 kujo  wheel  3325184 Oct  2 08:19 vectors.i8
exit=0
vectors.i8 identical      ← cmp against recommender/out/vectors.i8
```
Not yet tested on a real Actions runner. That happens on the next deploy after the push.

### `CODE_GUIDE.md` (+12)

It adds the three vote functions to the `db.ts` table, a paragraph on `votes` under
`schema.sql`, and the data step in the `deploy.yml` diagram and bullets. *Why:* the guide
documents every function, table, and deploy step, so it stays accurate.

## The release: `data-2026-10`

https://github.com/carterbris-1/reel-log/releases/tag/data-2026-10, tagged on `main`, with
6 assets:

| Asset | Size | Served on site? |
|---|---|---|
| `manifest.json` | 585 B | yes |
| `vectors.i8` | 3,325,184 B | yes |
| `catalogue.json` | 1,345,390 B | yes |
| `pca.npz` | 1,949,852 B | no (for `update.py`) |
| `genome_knn.npz` | 29,799,294 B | no (for `update.py`) |
| `embed_format.json` | 307 B | no (for `update.py`) |

**How it was created:** I tried `gh release create …`, and Claude Code's auto-mode
safety check blocked it for publishing data derived from licensed (MovieLens) data. I did
not work around it. You ran the same command yourself with `!`, after earlier accepting
the licence risk for personal use (spec risk 2).

## How it was built

- **Copy files by name instead of `--pattern '*.json'`.** A pattern would also have
  published `embed_format.json`, and `gh release download` errors when a pattern matches
  nothing, which would break the deploy until `onboarding.json` exists.
- **"Newest" means newest by `publishedAt`**, not tag name. (This first used `createdAt`,
  which turned out to be wrong; see "Review fixes → Fix 7".)
- **`GH_REPO` is set explicitly**, so `gh` doesn't depend on the checkout's git remote.
- ~~**`setVote` sets `voted_at` explicitly.**~~ Replaced by the server trigger in "Review
  fixes → Fix 5": `setVote` no longer sends a time.
- **Commits.** You approved two commits plus the release command. I ran the commits; the
  release was blocked and run by you. The push is pending its review (CLAUDE.md).

## How to try it

1. Supabase → **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
2. After the push deploys, open
   `https://carterbris-1.github.io/reel-log/data/manifest.json`. Expected: the manifest,
   with `"count": 12989`. It works on iPhone Safari too, but there's nothing visual to see
   until task 6.
3. Under the repo's **Actions → Build and deploy → build**, the "Add recommender data"
   step should list the three files.

---

# Review fixes (before the first push)

The pre-push review ran the `code-reviewer` agent and `/code-review high` (in a separate
session) on `origin/main..4cae719`. There were no critical findings, and six "should change"
items. You chose "fix first". All six are fixed in one follow-up commit.

| # | Found by | Problem | Fix |
|---|---|---|---|
| 1 | both | Deploy only checked `manifest.json`; a half-uploaded release could go live | Copy exactly what the manifest lists; fail if any is missing |
| 2 | /code-review | Manifest listed `onboarding.json`, which nothing writes yet | `files` lists only files that exist |
| 3 | /code-review | Version was just `2026-10`, so a same-month rebuild would leave phones on stale cached data | Version = month + content hash |
| 4 | /code-review | `getVotes()` silently stopped at Supabase's 1,000-row cap | Fetch in pages of 1,000 |
| 5 | /code-review | `voted_at` came from the device clock | Server trigger stamps `now()` |
| 6 | /code-review | Vote errors said "Lists are temporarily unavailable" | Votes get their own message |

The "fine to keep" items were not changed: a crash in the check-film sanity log, the
vote-count tiebreak in the MovieLens join, no empty-text guard, partial-sort speed, and
the loop-vs-single-call deploy download.

### Fix 1: `.github/workflows/deploy.yml` (lines 51–68)

Before: list the release's assets, download any of four hard-coded names that exist, and
check only `manifest.json`. After:

```yaml
          mkdir -p _site/data
          gh release download "$tag" --dir _site/data --pattern manifest.json \
            || { echo "::error::$tag has no manifest.json"; exit 1; }
          for f in $(jq -r '.files[]' _site/data/manifest.json); do
            gh release download "$tag" --dir _site/data --pattern "$f" \
              || { echo "::error::$tag is missing $f, which its manifest lists"; exit 1; }
          done
          echo "Added $tag (version $(jq -r .version _site/data/manifest.json)):"; ls -l _site/data
```

**Live test** against the existing `data-2026-10` release, which has the old manifest
listing `onboarding.json` (actual output):
```text
no assets match the file pattern
::error::data-2026-10 is missing onboarding.json, which its manifest lists
exit=1
```
That's the intended failure. It also means **a new release must be published before the
push**, or the first deploy will fail. The site would keep its current version, but no
deploys would get through until then.

### Fixes 2 and 3: `recommender/prep.py`

```python
# recommender/prep.py:250-259
def data_version(*files: bytes) -> str:
    """"2026-10-1a2b3c4d": month + a hash of the published bytes.

    Browsers cache the data under this version, so any rebuild that changes a file must
    change it. Month alone would leave phones on stale files after a same-month rebuild.
    """
    digest = hashlib.sha256()
    for f in files:
        digest.update(f)
    return f"{time.strftime('%Y-%m')}-{digest.hexdigest()[:8]}"
```

The manifest `files` before:
`{"vectors": "vectors.i8", "catalogue": "catalogue.json", "onboarding": "onboarding.json"}`.
After: `{"vectors": "vectors.i8", "catalogue": "catalogue.json"}`, with a comment that
`extras` (task 7) adds `onboarding` and a new version.

**Live example** (actual: `--stage vectors` rerun at 08:23):
```text
{"version":"2026-10-ac759f25","count":12989,"files":{"vectors":"vectors.i8","catalogue":"catalogue.json"},"bytes":{"vectors":3325184,"catalogue":1345390}}
vectors.i8 unchanged      ← cmp against the 07:53 build: the pipeline is deterministic
```
The release tag now follows the version: `data-2026-10-ac759f25`.

### Fixes 4–6: `src/db.ts` (lines 16, 26–41, 114–146)

```ts
const VOTES_UNAVAILABLE = "Your votes are temporarily unavailable. Try again in a moment.";
```
`run()` gained an optional message parameter, `unavailable = UNAVAILABLE`, so list calls
are unchanged.

```ts
export async function getVotes(): Promise<Vote[]> {
  const votes: Vote[] = [];
  for (let from = 0; ; from += VOTE_PAGE) {
    const page = await run<Vote[]>(
      client()
        .from("votes")
        .select("tmdb_id, thumb, voted_at")
        .order("voted_at", { ascending: false })
        .order("tmdb_id") // ties need a fixed order, or pages could overlap
        .range(from, from + VOTE_PAGE - 1),
      VOTES_UNAVAILABLE,
    );
    votes.push(...page);
    if (page.length < VOTE_PAGE) return votes;
  }
}
```

`setVote` before: `upsert({ tmdb_id: tmdbId, thumb, voted_at: new Date().toISOString() }, …)`.
After: `upsert({ tmdb_id: tmdbId, thumb }, { onConflict: "user_id,tmdb_id" })`, because the
server now sets the time.

### Fix 5: `supabase/schema.sql` (lines 64–79, appended to the votes block)

```sql
create or replace function public.stamp_vote() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.voted_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_vote on public.votes;
create trigger stamp_vote before insert or update on public.votes
  for each row execute function public.stamp_vote();
```
`before … update` also fires on the upsert's `do update`, so a flip or a Rewatch 👍
re-stamps. `set search_path = ''` is the hardening Supabase's security advisor asks for.
**Expected** behaviour: not run yet, since you haven't applied the SQL.

### Docs

The model doc §2 now has the new manifest example and explains the version. The spec
uses `data-<version>` instead of `data-YYYY-MM`. CODE_GUIDE describes the paged
`getVotes`, the trigger, the vote error message, and the deploy step's fail-on-missing.
`npm run typecheck` and `npm run build` pass.

### Release replacement (yours to run)

1. Publish `data-2026-10-ac759f25` with the rebuilt `out/` files. It becomes the newest,
   so the deploy picks it.
2. Optionally delete the old `data-2026-10` release and tag. It's harmless once it isn't
   the newest, but it can never deploy again.

### Fix 7: release ordering (found while testing the new release)

After you published `data-2026-10-ac759f25`, the deploy step still picked the **old**
`data-2026-10`. Actual output:
```text
no assets match the file pattern
::error::data-2026-10 is missing onboarding.json, which its manifest lists
exit=1
```
*Cause:* for a release, GitHub's `createdAt` is the date of the commit the tag points
at, not when the release was made. Both releases tag the same commit, so they tied:
```text
{"createdAt":"2026-09-30T16:04:25Z","publishedAt":"2026-10-02T15:48:32Z","tagName":"data-2026-10-ac759f25"}
{"createdAt":"2026-09-30T16:04:25Z","publishedAt":"2026-10-02T15:18:53Z","tagName":"data-2026-10"}
```
and the tie went to the old one. *Fix* (`deploy.yml:56-57`): select and sort by
`publishedAt`. Retest (actual output):
```text
Added data-2026-10-ac759f25 (version 2026-10-ac759f25):
-rw-r--r--@ 1 kujo  wheel  1345390 Oct  2 08:49 catalogue.json
-rw-r--r--@ 1 kujo  wheel      557 Oct  2 08:49 manifest.json
-rw-r--r--@ 1 kujo  wheel  3325184 Oct  2 08:49 vectors.i8
exit=0
manifest.json identical / vectors.i8 identical / catalogue.json identical
```

### Second review round (on all three commits)

The `code-reviewer` agent re-reviewed `origin/main..be32e98` and found no critical issues.

| Found | Fix | File |
|---|---|---|
| A malformed manifest (no `files`, empty `files`, invalid JSON) still deployed "successfully", because `bash -e` ignores a failing `jq` inside a `for` word list | Read the list into `files=$(jq -er …) \|\| exit 1` first, requiring a non-empty object | `deploy.yml` |
| The trigger re-stamps any edited `voted_at`, so task 10's "fake vote dates to 90 days old" can't work | Task 10 now says to move the worker's clock instead | `recommender-spec.md` |
| Offset paging could return a vote twice if another device writes between pages | De-duplicate by `tmdb_id` after paging | `src/db.ts` |
| Stale notes: the deploy comment said `data-YYYY-MM`, the model doc's release command left out `embed_format.json`, and a SCRATCH bullet still said `setVote` sends `voted_at` | Corrected | `deploy.yml`, `recommender-model.md`, this file |

```bash
# deploy.yml, the new guard before the download loop
files=$(jq -er '.files | if type == "object" and length > 0 then .[] else error("no files") end' \
  _site/data/manifest.json) || { echo "::error::$tag has an invalid manifest.json"; exit 1; }
for f in $files; do
```

```ts
// src/db.ts, the end of getVotes()
  // A vote from another device between two pages shifts rows, so one could appear twice.
  const seen = new Set<number>();
  return votes.filter((v) => !seen.has(v.tmdb_id) && seen.add(v.tmdb_id));
```

**Tests** (actual output): the full step against the real release, plus the guard alone
against bad manifests:
```text
== real release
exit=0 files: catalogue.json manifest.json vectors.i8
== bad manifests (jq part only)
  {"version":"x"} -> rejected
  {"files":{}} -> rejected
  not json -> rejected
  {"files":{"vectors":"vectors.i8"}} -> accepted: vectors.i8
```

### Third round (`/code-review` on all three commits)

`/code-review high` (separate session) found ten items. One was the `jq` gap above, found
by both reviewers. The others:

| Found | Decision |
|---|---|
| `getVotes` stopped when a page held < 1,000 rows, so it would drop votes if Supabase's Max Rows is set lower | **Fixed:** stop only on an empty page (one extra request) |
| Offset paging can skip or repeat a row when a vote lands mid-load | **Partly:** repeats are removed by the de-dup. A skip needs >1,000 votes *and* a vote during loading; left as a known limit |
| The join tiebreak preferred more votes over an exact `tmdbId` match (flagged by both reviewers across rounds) | **Fixed:** exact match first, then votes. Measured on the current data: **0** genome assignments change (the only shared movieId is *King Kong vs. Godzilla*, where both rules agree), so `join` wasn't rerun |
| Draft or pre-release `data-*` releases could be picked | **Fixed:** `--exclude-drafts --exclude-pre-releases` |
| Publishing a release doesn't redeploy | **Documented** in CODE_GUIDE (run `gh workflow run deploy.yml`). A `release: published` trigger was rejected: it builds the tag's commit, and both data tags point at the old `3dc6800`, so it would roll back the site's code |
| A null plot text would crash `embed` | **Fixed:** `fill_null("")` (none in the current data) |
| A missing check film crashed `vectors` after the files were written | **Fixed:** log and skip |
| `voted_at default now()` is redundant with the trigger | **Kept** as a fallback, with a comment saying the trigger sets it |
| Repeated full argsorts in the checks | **Kept:** speed only, ~1 s today |

```python
# recommender/prep.py, join tiebreak
    taken = pl.col("movieId").is_not_null() & pl.col("movieId").is_duplicated()
    score = pl.col("by_tmdb").cast(pl.Float64) * 1e12 + pl.col("vote_count")
    first = score.rank("ordinal", descending=True).over("movieId") == 1
```

**Checks** (actual output): the new tiebreak on the real joined data gives
`rows whose genome would change: 0`. `--stage vectors` reran:
`data version 2026-10-ac759f25 → publish as release data-2026-10-ac759f25`, which is
unchanged, so the published release stays valid. The deploy step against the live releases
prints `Added data-2026-10-ac759f25 (version 2026-10-ac759f25):`. `npm run typecheck` passes.
