# SCRATCH 2026-10-02: Recommender spec + data prep (tasks 1, 2, 15)

## Summary

The "For You" recommender spec was filled out into two files, and its first two tasks were
built and run. `recommender/prep.py` now turns the Hugging Face movie dataset and
MovieLens 25M into the three files the browser will load: `vectors.i8`, `catalogue.json`,
and `manifest.json`. Nothing in the site itself (`src/`, `index.html`) has changed yet.

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
- Nothing is committed.
