# Reel Log "For You" Recommender: Spec
> A new Reel Log page that learns your taste from thumbs up / thumbs down only. Python
> builds the movie vectors offline (one-time, then monthly); the browser does all scoring
> and retraining in TypeScript. Biggest constraint: there is still no server, so the whole
> model has to fit on an iPhone and retrain in milliseconds.

**Files:** this spec (what, why, tasks, decisions) · [recommender-model.md](recommender-model.md)
(pipeline, scoring math, file formats, worker protocol, build setup).

## 1. What it is

A single-user recommender inside the existing Reel Log site (GitHub Pages + Supabase +
TMDB). The only input is a thumb: 👍 means "I'd want to watch this" and 👎 means "I
wouldn't", so you can vote on movies you haven't seen. TMDB's own "recommendations"
endpoint is per-movie and popularity-driven, so it can't learn a personal taste. Hosting a
Python model server costs money or has cold starts, and it would be the first piece of
Reel Log holding secrets. So Python does the heavy one-off work (download, join, embed,
compress), and the result ships as static files. The browser loads them once, then scores
about 13k movies against your votes on every tap.

## 2. Requirements

**Data prep (Python)**
- R1. `recommender/prep.py` (run on your Mac) streams the Hugging Face dataset
  `remsky/Embeddings__Ultimate_1Million_Movies_Dataset` (1.04M rows) and downloads
  MovieLens 25M. It keeps movies with `vote_count >= 200`, joins them to the Tag Genome
  through `links.csv`, re-embeds every plot with a pinned `nomic-embed-text-v1.5` (§5.3),
  and writes the published files (model §1–2).
- R2. `recommender/update.py` runs monthly in GitHub Actions. It adds new TMDB releases,
  embeds them with the same pinned model and text format, refreshes `popularity`/`vote_count`/rating
  for the last 2 years, publishes a `data-YYYY-MM` release, and redeploys (model §5).
- R3. HF embeddings are stringified lists. Rows that fail to parse or aren't 768-d are
  dropped and counted in the prep log.

**Vectors and model**
- R4. Every movie gets one combined vector built from a Tag Genome block and a plot block,
  each centred and L2-normalised. A movie without genome data gets an *imputed* genome
  block (§5.1), not zeros.
- R5. The taste score starts as a kNN score: mean similarity to the k=5 nearest 👍 movies,
  minus a penalty from the nearest 👎 movie. The penalty only applies above similarity
  τ=0.55, so a 👎 pushes away close neighbours, not a whole genre (model §3).
- R6. From 30 votes on (with at least 5 of each thumb), blend in an L2-regularised logistic
  regression: `taste = (1−α)·z(kNN) + α·z(logreg)`, with α ramping from 0.2 at 30 votes to
  0.5 at 150. It retrains after every vote, flip, or removal.
- R7. A voted movie never appears as a recommendation, except through Rewatch (R12).

**Onboarding (shown when you have 0 votes)**
- R8. Shows 15 well-known movies, one per k-means cluster of the 3,000 most-voted films,
  as a one-at-a-time card flow (poster, title, year, 👍/👎) with a "3 of 15" counter. Each
  vote saves immediately, so leaving halfway resumes at the next unvoted card. After 15,
  you land on For You.

**For You (main screen, `#/foryou`)**
- R9. Shows 4 cards, each with poster, title, year, genres, an overview cut to about 200
  characters at a word boundary, and 👍/👎. Overviews come live from TMDB `/movie/{id}` (4
  calls per refresh). If one fails, that card shows without an overview, not an error.
- R10. Voting on a card replaces *that card, in place*, with a new pick of the same slot
  type. A full refresh (opening the page, or pressing ↻) re-picks all 4 and shuffles their
  order.
- R11. The four slots (exact pools and ranks in model §3):

| Slot | Candidate pool | Ranking |
|---|---|---|
| Mainstream ×2 | Comedy/Action/Thriller/Adventure/Sci-Fi, `vote_count` in the top 20% | taste, +0.3 z if from the last 10 years |
| Artsy | `artsy >= 0.6` (§5.2), rating ≥ 7.2, `popularity` below the median | taste |
| Explore | furthest from everything you've voted on (bottom 15% of max similarity), rating ≥ 7.0, `vote_count >= 500` | random pick from the top 20 by rating |

- R12. **Rewatch:** on about 1 in 5 full refreshes, one mainstream slot shows a 👍 movie
  you voted on more than 60 days ago, with a "Rewatch" badge. 👍 re-stamps the vote; 👎
  flips it to disliked. This is the only place a voted movie can reappear.
- R13. The 4 cards never include two movies with similarity above 0.85 (no *John Wick 3*
  next to *John Wick 4*). Movies shown but not voted on sit out the next 3 refreshes
  (cooldown in `localStorage`, so it's per device).
- R14. Tapping the poster opens the existing `#/movie/{id}` page. Ratings filter but are
  never shown, matching Reel Log R5.
- R15. A vote button disables until Supabase confirms the write. On failure, the card
  stays, the vote is not applied to the model, and a toast says "Couldn't save. Try again."

**History (`#/foryou/history`)**
- R16. Two tabs, Liked and Disliked, as poster grids sorted newest vote first. Each poster
  has "Flip" and "Remove". Either one updates Supabase and retrains before the next pick.
  Votes for movies missing from the catalogue still show, using TMDB for title and poster.

**Loading, errors, and both platforms**
- R17. First load shows a progress bar over the ~4–5 MB download, then caches it. Later loads
  start from Cache Storage with no network wait beyond `manifest.json`.
- R18. If the data files are missing (no release yet) or fail to load, the page shows a
  notice with Try again, and the rest of Reel Log is unaffected.
- R19. "For You" appears in the header nav only when signed in. Signed out, `#/foryou`
  prompts sign-in like Lists does. The page credits "Recommendations use MovieLens data
  (GroupLens)", with no wording that implies endorsement.
- R20. Works on iPhone Safari, the Home Screen app, and desktop. Thumb buttons are 44px or
  larger, nothing is hover-only, and safe areas are respected (CODE_GUIDE §11).

## 3. Stack and infrastructure

| Piece | Choice | Constraint it imposes |
|---|---|---|
| Prep | Python 3.12, `polars`, `numpy`, `scikit-learn` (PCA, KMeans, Ridge), `huggingface_hub`, pinned in `recommender/requirements.txt` | ~7.3 GB of downloads (HF parquet 7 GB, ML-25M 250 MB). Needs lazy filtering to stay under ~8 GB RAM. Runs locally, not in CI |
| Embedding | `nomic-embed-text-v1.5` (768-d, revision pinned) via `sentence-transformers`, `transformers<5` | ~4 min for the whole catalogue on Apple MPS. New films must use the saved text format (§5.3) |
| Monthly job | Actions cron `0 6 1 * *`, `update.py`, `permissions: contents: write, actions: write` | Needs a `TMDB_API_KEY` repo secret. Model download cached with `actions/cache`. Must dispatch `deploy.yml` itself |
| Data hosting | GitHub **Release** `data-YYYY-MM` assets, downloaded by `deploy.yml` into `_site/data/` | Same-origin, so no CORS. Binaries stay out of git history. A data update needs a redeploy |
| Scoring | TypeScript in a module **Web Worker**, no libraries, built by a second `tsc` config (model §4) | Pure typed-array math. The main thread never blocks on a vote. Needs iOS 15+ |
| Tests | `node --test` on compiled `js/rec/*.test.js` (Node 24, already in CI) | First tests in the repo. Only the pure math is tested, not the UI |
| Votes | Supabase table `votes` with RLS, same project as lists | Syncs phone ↔ computer. `keepalive.yml` already handles the 7-day pause |
| Data cache | Cache Storage `reel-rec-<version>` | iOS evicts it after 7 days unused. It re-downloads with a progress bar |

Cost: $0 (Releases, ~15 Actions min/month, Pages). A FastAPI server on Fly.io was rejected:
~$5/month, 30s free-tier cold starts, and per-vote latency for math a phone does in ~20 ms.

## 4. Data model

**Published per release** (formats in model §2): `manifest.json`, `vectors.i8`
(N × 256 int8, 3.3 MB at N=12,989), `catalogue.json` (columnar, ~1 MB gzipped),
`onboarding.json`.

**Release-only artefacts** (not served): `pca.npz`, `genome_knn.npz`, `artsy_ridge.npz`,
`embed_format.json`. The monthly job reuses them so the vector space never shifts.

**Supabase** (appended to `supabase/schema.sql`, same idempotent style):

```sql
create table if not exists public.votes (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  tmdb_id   int  not null,
  thumb     smallint not null check (thumb in (1, -1)),
  voted_at  timestamptz not null default now(),
  primary key (user_id, tmdb_id)          -- one vote per movie: flip = upsert
);
alter table public.votes enable row level security;
drop policy if exists "own votes" on public.votes;
create policy "own votes" on public.votes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
```

**`src/db.ts`:** `getVotes()`, `setVote(tmdbId, thumb)` (upsert, re-stamps `voted_at`),
`removeVote(tmdbId)`, via `run()`. Votes store only `tmdb_id`, so new releases never strand them.

**`localStorage`** (per device, wrapped in try/catch): `rec.cooldown` as
`{ tmdb: refreshesLeft }`, and `rec.refreshes` as a counter for Rewatch.

Worker state and messages are in model §3.

## 5. Hard parts

**5.1 Two populations of vectors.** Measured: 8,482 of 12,989 movies (65%) have genome
scores. The other 4,507 include **every** 2020+ film (ML-25M stops in 2019) and half of
2015–19. A zero genome block would make them look unlike everything. Each one instead
gets a weighted average of the real genome blocks of its **5 closest films by plot and
genre**. Ridge regression was tried first and made imputed films near-copies of each
other. The test that matters is mixing: imputed films are 35% of the catalogue and 41% of
genome films' neighbours (model §1). Both blocks are **mean-centred before normalising**,
or every pair looks ~0.8 similar and τ means nothing. PCA to 256-d keeps 84% of each film's
top-10 neighbours; int8 is scaled to the largest entry, so nothing clips.

**5.2 "Artsy" for movies with no genome.** For genome movies it's the mean relevance of a
fixed tag set: art house, criterion, visually appealing, cinematography, great
cinematography, beautifully filmed, visually stunning, atmospheric, surreal, masterpiece,
independent film. Prep fails loudly if a name is missing from `genome-tags.csv`. For the
rest, a second Ridge predicts it from the vector, and directors whose genome films average
≥ 0.7 give their other films +0.1, which catches new auteur releases.

**5.3 Inconsistent embeddings.** The HF vectors were made in two formats: raw text for the
early rows, genres appended for later ones (measured: cosine 1.000 vs 0.990 when
re-embedded). The later group, which overlaps the no-genome group, clumped at 0.95
similarity and was 95% its own neighbours. So prep re-embeds **all** films' raw
`"{title}: {tagline}: {overview}"` with a pinned model, recorded in `embed_format.json`.
`update.py` embeds new films the same way, so they can't drift.

**5.4 Retraining on every tap, on a phone.** A naive rescore is N × votes × 256, about 1.0
billion operations at 300 votes. Instead each vote stores one similarity column, computed
once (~3.3M ops, ~3–8 ms). Scoring then reads only those int8 columns. A flip changes
`thumb` and a remove deletes the column, so neither recomputes anything. Logistic
regression is 200 warm-started gradient steps over ≤ 500 rows × 256, under 10 ms. Memory at
500 votes is 6.5 MB of columns, which iOS tolerates.

**5.5 Building a worker with no bundler.** `tsc` compiles one file per file, and the DOM
and WebWorker type libraries conflict in one config. The math goes in a DOM-free
`model.ts`, the worker gets its own tsconfig, and `npm run build` runs both (model §4).

**5.6 Newest movies can't reach vote_count 200 in a month.** For films from the last 12
months, `update.py` accepts `vote_count >= 50`, re-checks monthly, and drops any still
under 200 at 12 months.

## 6. Scope

**v1:** R1–R20, the monthly job, and the "For You" nav link.

**Later:** a "Why this?" line per card (naming the nearest 👍 movie), a streaming-provider
filter (TMDB `/watch/providers`), re-running onboarding on demand, an "add to list" button
on cards, and syncing cooldown through Supabase.

**Out of scope:** ratings, reviews, sliders, text input, multiple users, server scoring, TV.

## 7. Tasks

### Phase A: Data and one working slice
1. **Prep: download, join, filter** (model §1 `join`). Depends on nothing. *Done when:* the
   log prints the HF schema, row count, genome coverage, and parse failures, and
   *Inception* (27205) has both blocks. ✅ 2026-10-02: 12,989 films, 8,482 with genome.
2. **Prep: embed + vectors** (model §1). Depends on 1. *Done when:* imputed films make up
   ≥ 30% of genome films' neighbours, PCA recall ≥ 0.80, and the decoded neighbours of
   *Alien* (348) and *Dune* (438631) are recognisably right. ✅ 2026-10-02
3. **Votes table and data plumbing.** Add `votes` to `schema.sql` and the three `db.ts`
   functions. Publish a first `data-2026-10` release by hand. `deploy.yml` downloads the
   newest `data-*` release into `_site/data/` and skips it if there's none. Depends on 2.
   *Done when:* the live site serves `/data/manifest.json`, and a deploy with no release
   still succeeds.
4. **Worker build and test setup** (model §4). Depends on nothing. *Done when:*
   `npm run build` emits `js/rec/worker.js`, `npm test` runs one passing test, and
   `deploy.yml` ships no `*.test.js`.
5. **Worker: load, cache, kNN** (R5, R17). Depends on 3, 4. *Done when:* in the console,
   3 👍 votes for Pixar films return other animated films in the top 10, and a reload
   loads from Cache Storage without refetching `vectors.i8`.
6. **For You page, one plain slot** (R9, R10, R15, R19). Depends on 5. *Done when:* a
   vote on the iPhone shows up on the computer after a reload, and that movie never
   reappears.

### Phase B: The four slots and onboarding
7. **Prep: artsy, `main` flag, onboarding clusters** (model §1 `extras`). Depends on 2.
   *Done when:* the top 20 by artsy include films like *In the Mood for Love* and
   *Stalker*, and `onboarding.json` holds 15 distinct, recognisable titles.
8. **Slot pools, shuffle, diversity, cooldown** (R10, R11, R13). Depends on 6, 7. *Done
   when:* 20 refreshes in a row never keep a slot type in one position, never show two
   cards above 0.85 similarity, and never show a voted movie.
9. **Explore slot and pool fallbacks.** Depends on 8. *Done when:* after 20 votes on action
   films only, the explore card is never an action film, and a forced-empty artsy pool
   still fills the slot.
10. **Rewatch** (R12). Depends on 8. *Done when:* with vote dates faked to 90 days old,
    about 20% of refreshes show a badged 👍 movie, and 👎 on it moves it to Disliked.
11. **Onboarding** (R8). Depends on 6, 7. *Done when:* a fresh account sees the 15 cards,
    quitting at card 8 resumes at card 9, and after 15 it never sees onboarding again.

### Phase C: Learning, history, polish
12. **Logistic regression blend** (R6). Depends on 5. *Done when:* unit tests on synthetic
    data separate two clusters with > 95% accuracy, and retraining at 300 votes logs under
    50 ms on an iPhone.
13. **History page** (R16). Depends on 6. *Done when:* flipping a 👍 to 👎 visibly changes
    the next picks, Remove makes the movie eligible again, and an orphan vote renders.
14. **Errors and iOS pass** (R18, R20). Depends on 11, 13. *Done when:* the full flow works
    in a 375px Home Screen app, including a cold start after clearing site data, and in
    airplane mode the page shows the notice instead of hanging.

### Phase D: Monthly freshness
15. **Embedding format** (§5.3). ✅ Folded into task 2: `embed_format.json` written.
16. **`update.py` and monthly workflow** (R2, §5.6). Depends on 2, 7. *Done when:* a
    manual `workflow_dispatch` publishes `data-YYYY-MM` with last month's releases, the
    site redeploys on its own, and the browser picks up the new version on its next load.

## 8. Risks and gotchas

1. **The HF dataset was renamed** (`Remsky/…` → `remsky/…`) and is one 7 GB row group. A
   future rename or reshape breaks `join`; the stage checks columns first and stops.
2. **MovieLens licence.** GroupLens forbids redistribution. This is personal use, not
   published or shared. The repo and Pages site are public, so the files are reachable by
   URL, but nothing links to them. Revisit if the site is ever promoted.
3. **iOS Cache Storage eviction** after 7 days unused means a silent ~4–5 MB re-download,
   possibly on mobile data. R17's progress bar makes it visible rather than a blank page.
4. **Cold start.** Under 5 👍, kNN is noisy. If every onboarding vote is 👎, ranking falls
   back to popularity minus dislikes until the first 👍 (model §3).
5. **Popularity goes stale** for older films, since only the last 2 years refresh. Fine for
   slot gating, and it's why "mainstream" leans on `vote_count`.
6. **`deploy.yml` now depends on a release.** The download step must tolerate none existing
   (R18), or every deploy before task 3 fails.
7. **Releases made by `GITHUB_TOKEN` don't trigger workflows.** The monthly job must run
   `gh workflow run deploy.yml` itself, or new data never goes live.
8. **Stale worker after deploy.** `index.html` busts caches with `?v=N`. The worker URL
   needs the same bump, or a phone keeps running old math against new data.
9. **Orphan votes.** A movie merged or deleted on TMDB 404s. History hides that poster
   instead of crashing; the vote stays in Supabase.
10. **Remote model code.** nomic's model runs downloaded Python (`trust_remote_code`). The
    revision is pinned so a changed upstream can't run unreviewed; bump it deliberately.

## 9. Assumptions and open decisions

| # | Question | Default assumed |
|---|---|---|
| 1 | Where does Python run? | **Answered:** offline prep + monthly Action only. Scoring is in the browser |
| 2 | Rewatch: which voted movies can reappear? | 👍 only, voted 60+ days ago, ~1 in 5 refreshes, mainstream slot only |
| 3 | Where do votes live? | Supabase `votes`, so they sync phone ↔ computer |
| 4 | Page name / route | "For You" at `#/foryou`, History at `#/foryou/history` |
| 5 | Does one vote reshuffle all 4 cards? | No: replaced in place; shuffle on full refresh only |
| 6 | Vector size | PCA 256-d, int8 (3.3 MB), 84% neighbour recall. 320-d: 4.2 MB for 86% |
| 7 | Genome vs plot weight; imputation | 0.6 / 0.4 for every film; kNN k=5 imputation (Ridge measured worse) |
| 8 | kNN constants | **Answered:** one binary 👍/👎 per movie, no ratings. k=5; penalty from the closest 👎 above τ=0.55, λ=0.5 |
| 9 | Logreg blend | From 30 votes with ≥ 5 of each, α 0.2 → 0.5 by 150 votes |
| 10 | "Last ~10 years" for mainstream | A +0.3 z preference, not a filter |
| 11 | Overviews | Fetched live from TMDB per card, not shipped |
| 12 | Onboarding | 15 clusters from the 3,000 most-voted films; resumable; no skip button |
| 13 | Is "Rewatch" 👍 a new vote? | It re-stamps `voted_at`; 👎 flips to Disliked |
| 14 | Rating source | TMDB `vote_average`, never displayed |
| 15 | Data hosting | Release assets copied into Pages at deploy, never committed |
| 16 | Does For You need sign-in? | Yes, like Lists |
| 17 | Same picks on every refresh? | No: weighted random from the top 10 per slot |
| 18 | Cooldown across devices | Per device (`localStorage`); syncing it is "later" |
| 19 | Vote save failures | Not applied to the model until Supabase confirms (R15) |
| 20 | MovieLens licence | **Answered:** personal use, not published; genome data kept |
| 21 | Test runner | Built-in `node --test`, no new dependency beyond `@types/node` |
