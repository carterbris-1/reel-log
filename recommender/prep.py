"""Builds the For You recommender's data files. See recommender-model.md §1.

Run from the repo root:
    recommender/.venv/bin/python recommender/prep.py --stage join

Each stage reads the previous stage's output from recommender/work/, so a failed stage
reruns on its own. Downloads are cached in recommender/cache/.
"""

import argparse
import gzip
import hashlib
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import polars as pl
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem

ROOT = Path(__file__).parent
CACHE = ROOT / "cache"
WORK = ROOT / "work"
OUT = ROOT / "out"

ML_URL = "https://files.grouplens.org/datasets/movielens/ml-25m.zip"
ML_FILES = ["links.csv", "genome-scores.csv", "genome-tags.csv"]
HF_PATH = "datasets/remsky/Embeddings__Ultimate_1Million_Movies_Dataset/movies_with_embeddings.parquet"
HF_COLUMNS = [
    "id", "title", "release_date", "status", "imdb_id", "original_language",
    "vote_average", "vote_count", "popularity", "genres", "director", "poster_path",
    "title_tagline_overview", "embedding",
]
MIN_VOTES = 200
PLOT_DIMS = 768
GENOME_TAGS = 1128
INCEPTION = 27205
DIMS = 256
WEIGHT_GENOME = 0.6  # plot gets the rest
IMPUTE_K = 5
IMPUTE_TEMP = 0.05
MIN_PCA_RECALL = 0.80
CHECK_FILMS = [27205, 348, 862, 438631, 872585]  # Inception, Alien, Toy Story, Dune, Oppenheimer
EMBED_MODEL = "nomic-ai/nomic-embed-text-v1.5"
EMBED_REVISION = "e9b6763023c676ca8431644204f50c2b100d9aab"
# TMDB's 19 movie genres in /genre/movie/list order. Bit i of a catalogue genre mask = GENRES[i].
GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
    "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction",
    "TV Movie", "Thriller", "War", "Western",
]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ── MovieLens ─────────────────────────────────────────────────────────────────

def movielens() -> Path:
    """Download ml-25m.zip once and extract only the files prep uses."""
    out = CACHE / "ml-25m"
    if all((out / f).exists() for f in ML_FILES):
        return out
    out.mkdir(parents=True, exist_ok=True)
    zip_path = CACHE / "ml-25m.zip"
    if not zip_path.exists():
        log(f"downloading {ML_URL} (~250 MB)")
        tmp = zip_path.with_suffix(".part")
        urllib.request.urlretrieve(ML_URL, tmp)
        tmp.rename(zip_path)
    with zipfile.ZipFile(zip_path) as z:
        for name in ML_FILES:
            (out / name).write_bytes(z.read(f"ml-25m/{name}"))
    zip_path.unlink()  # 250 MB we no longer need; the disk is tight
    return out


def genome_matrix(ml: Path) -> pl.DataFrame:
    """genome-scores.csv (long, 15.6M rows) → one row per movieId with a 1,128-float array."""
    scores = (
        pl.scan_csv(ml / "genome-scores.csv", schema={"movieId": pl.Int32, "tagId": pl.Int32, "relevance": pl.Float32})
        .sort(["movieId", "tagId"])
        .collect()
    )
    per_movie = scores.group_by("movieId", maintain_order=True).agg(pl.col("relevance"), pl.len().alias("n"))
    bad = per_movie.filter(pl.col("n") != GENOME_TAGS)
    if bad.height:
        sys.exit(f"genome: {bad.height} movies don't have exactly {GENOME_TAGS} tags")
    return per_movie.select(
        "movieId", pl.col("relevance").list.to_array(GENOME_TAGS).alias("genome")
    )


# ── Hugging Face plot embeddings ──────────────────────────────────────────────

def hf_movies() -> pl.DataFrame:
    """Stream the 7 GB parquet over HTTP, keeping only movies with enough votes.

    The file is a single row group, so pyarrow would normally load the whole 6.5 GB
    embedding column at once. A buffered stream without pre-buffering reads it page by
    page instead, so memory stays at one batch and nothing large touches the disk.
    """
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
            if time.time() - last > 15:
                last = time.time()
                rows = sum(k.height for k in kept)
                log(f"  {seen:,} rows scanned ({fh.tell() / total:.0%} of file), {rows:,} kept")
    log(f"  {seen:,} rows scanned, done")
    return pl.concat(kept)


def parse_embeddings(df: pl.DataFrame) -> tuple[pl.DataFrame, int]:
    """Stringified "[0.1, 0.2, …]" → float32[768]. Drops rows that fail or are the wrong size."""
    vecs, ok = [], []
    for s in df["embedding"]:
        v = None
        if s and s.startswith("[") and s.endswith("]"):
            try:
                v = np.array(s[1:-1].split(","), dtype=np.float32)
            except ValueError:
                v = None
        good = v is not None and v.shape == (PLOT_DIMS,) and bool(np.isfinite(v).all())
        ok.append(good)
        vecs.append(v if good else np.zeros(PLOT_DIMS, np.float32))
    mask = pl.Series(ok)
    plot = pl.Series("plot", np.stack(vecs), dtype=pl.Array(pl.Float32, PLOT_DIMS))
    out = df.drop("embedding").with_columns(plot).filter(mask)
    return out, df.height - out.height


# ── Stage: join ───────────────────────────────────────────────────────────────

def stage_join() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    ml = movielens()
    log("MovieLens ready")

    movies = hf_movies()
    movies, parse_failed = parse_embeddings(movies)
    before = movies.height
    movies = movies.sort("vote_count", descending=True).unique("id", keep="first", maintain_order=True)
    dupes = before - movies.height

    # tmdbId first; imdbId (HF "tt0137523" → 137523) for films MovieLens has no TMDB id for.
    links = pl.read_csv(ml / "links.csv", schema={"movieId": pl.Int32, "imdbId": pl.Int64, "tmdbId": pl.Int64})
    by_tmdb = links.drop_nulls("tmdbId").unique("tmdbId", keep="first").select(
        pl.col("tmdbId").alias("id"), pl.col("movieId").alias("ml_tmdb")
    )
    by_imdb = links.unique("imdbId", keep="first").select(
        pl.col("imdbId").alias("imdb_num"), pl.col("movieId").alias("ml_imdb")
    )
    movies = (
        movies.with_columns(
            pl.col("imdb_id").str.strip_prefix("tt").cast(pl.Int64, strict=False).alias("imdb_num")
        )
        .join(by_tmdb, on="id", how="left")
        .join(by_imdb, on="imdb_num", how="left")
        .with_columns(pl.coalesce("ml_tmdb", "ml_imdb").alias("movieId"))
        .drop("ml_tmdb", "ml_imdb", "imdb_num")
    )

    log("pivoting genome scores (15.6M rows)")
    genome = genome_matrix(ml)
    movies = movies.join(genome, on="movieId", how="left")
    # Two TMDB ids can map to one MovieLens movie; only the more-voted one keeps the genome.
    taken = pl.col("movieId").is_not_null() & pl.col("movieId").is_duplicated()
    first = pl.col("vote_count").rank("ordinal", descending=True).over("movieId") == 1
    movies = movies.with_columns(
        pl.when(taken & ~first).then(None).otherwise(pl.col("genome")).alias("genome")
    )

    out = WORK / "joined.parquet"
    movies.write_parquet(out)

    n_genome = movies["genome"].is_not_null().sum()
    log(
        f"rows={movies.height:,} genome={n_genome:,} ({n_genome / movies.height:.0%}) "
        f"parse_failed={parse_failed} dupes={dupes} → {out} ({out.stat().st_size / 1e6:.0f} MB)"
    )
    inc = movies.filter(pl.col("id") == INCEPTION)
    if inc.height != 1 or inc["genome"][0] is None:
        sys.exit("check failed: Inception (27205) should have both a plot and a genome block")
    log(f"check ok: {inc['title'][0]} has plot[{PLOT_DIMS}] and genome[{GENOME_TAGS}]")
    log(f"genres sample: {movies['genres'][0]!r}")


# ── Stage: embed ──────────────────────────────────────────────────────────────

def embedder():
    import torch
    from sentence_transformers import SentenceTransformer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return SentenceTransformer(EMBED_MODEL, revision=EMBED_REVISION, trust_remote_code=True, device=device)


def stage_embed() -> None:
    """Re-embed every film's plot text in one consistent format.

    The HF vectors were made in two formats: the dataset's first rows (mostly older,
    popular films) from the raw text, later rows with the genres appended. Those later
    films, which are also the ones with no genome, ended up ~0.95 similar to each other
    and almost never neighboured the rest. Re-embedding the raw text reproduces the first
    group exactly (cosine 1.000) and puts everyone in the same space.
    """
    movies = pl.read_parquet(WORK / "joined.parquet")
    texts = movies["title_tagline_overview"].to_list()
    model = embedder()
    log(f"embedding {len(texts):,} texts with {EMBED_MODEL} on {model.device} (~50/s)")
    t = time.time()
    fresh = model.encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True,
                         show_progress_bar=False).astype(np.float32)
    log(f"  done in {time.time() - t:.0f}s")

    stored = normalise(movies["plot"].to_numpy().astype(np.float32))
    cos = np.sum(fresh * stored, axis=1)
    has_g = movies["genome"].is_not_null().to_numpy()
    log(f"cosine to the HF vectors: genome films {cos[has_g].mean():.3f}, others {cos[~has_g].mean():.3f}")

    movies = movies.with_columns(pl.Series("plot", fresh, dtype=pl.Array(pl.Float32, PLOT_DIMS)))
    movies.write_parquet(WORK / "embedded.parquet")
    (WORK / "embed_format.json").write_text(json.dumps({
        "model": EMBED_MODEL, "revision": EMBED_REVISION, "library": "sentence-transformers",
        "prefix": "", "text": "{title}: {tagline}: {overview}", "normalize": True,
        "note": "tagline may be empty, giving 'Title: : overview'. No genres appended.",
    }, indent=2))
    log("wrote embedded.parquet and embed_format.json")


# ── Stage: vectors ────────────────────────────────────────────────────────────

def data_version(*files: bytes) -> str:
    """"2026-10-1a2b3c4d": month + a hash of the published bytes.

    Browsers cache the data under this version, so any rebuild that changes a file must
    change it. Month alone would leave phones on stale files after a same-month rebuild.
    """
    digest = hashlib.sha256()
    for f in files:
        digest.update(f)
    return f"{time.strftime('%Y-%m')}-{digest.hexdigest()[:8]}"


def normalise(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.where(n == 0, 1, n)


def genre_mask(genres: pl.Series) -> np.ndarray:
    """"Action, Thriller" → bool[n, 19] in GENRES order. Fails on a name TMDB doesn't use."""
    out = np.zeros((len(genres), len(GENRES)), dtype=bool)
    index = {g: i for i, g in enumerate(GENRES)}
    for row, s in enumerate(genres):
        for name in filter(None, (s or "").split(", ")):
            if name not in index:
                sys.exit(f"unknown genre {name!r}; add it to GENRES")
            out[row, index[name]] = True
    return out


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


def neighbours(q: np.ndarray, inv: np.ndarray, titles: list[str], row: int, k: int = 10) -> list[str]:
    """Nearest titles to `row`, decoded from the int8 vectors exactly as the browser will."""
    sims = (q.astype(np.int32) @ q[row].astype(np.int32)) * inv * inv[row]
    sims[row] = -2
    return [f"{titles[i]} ({sims[i]:.2f})" for i in np.argsort(-sims)[:k]]


def stage_vectors() -> None:
    from sklearn.decomposition import PCA

    OUT.mkdir(parents=True, exist_ok=True)
    movies = pl.read_parquet(WORK / "embedded.parquet")
    n = movies.height
    has_g = movies["genome"].is_not_null().to_numpy()
    log(f"{n:,} movies, {has_g.sum():,} with genome, {(~has_g).sum():,} to impute")

    # Plot block: centre, then unit length.
    plot_raw = movies["plot"].to_numpy().astype(np.float32)
    plot_mean = plot_raw.mean(axis=0)
    P = normalise(plot_raw - plot_mean)

    # Genome block. Raw relevance is all positive, so without centring every pair of
    # films scores ~0.8 similar and the 👎 threshold τ would mean nothing.
    g_raw = np.stack(movies.filter(pl.col("genome").is_not_null())["genome"].to_numpy()).astype(np.float32)
    genome_mean = g_raw.mean(axis=0)
    g_centred = g_raw - genome_mean

    # Impute genome for the rest: a weighted average of the real genome blocks of the
    # K films closest by plot + genres. Ridge was tried first and made the imputed films
    # near-copies of each other (95% of their neighbours were other imputed films); kNN
    # keeps them mixed in with the rest. Comparison: recommender-model.md §1.
    genres = genre_mask(movies["genres"])
    feats = np.hstack([P, genres.astype(np.float32)])
    f_g, G_real = feats[has_g], normalise(g_centred)
    order = np.random.default_rng(0).permutation(len(f_g))
    test, train = order[:1500], order[1500:]
    pred = knn_impute(f_g[test], f_g[train], G_real[train])
    cos = float(np.mean(np.sum(pred * G_real[test], axis=1)))
    log(f"genome imputation (kNN k={IMPUTE_K}), held out: mean cosine to the real block={cos:.3f}")

    G = np.empty((n, GENOME_TAGS), dtype=np.float32)
    G[has_g] = G_real
    G[~has_g] = knn_impute(feats[~has_g], f_g, G_real)
    X = normalise(np.hstack([WEIGHT_GENOME * G, (1 - WEIGHT_GENOME) * P]))

    # Mixing check: how often each group's nearest neighbours come from the imputed group.
    sample = np.random.default_rng(1).choice(n, 2000, replace=False)
    sims = X[sample] @ X.T
    sims[np.arange(len(sample)), sample] = -2
    nn_imputed = ~has_g[np.argsort(-sims, axis=1)[:, :10]]
    log(
        f"imputed share: catalogue {(~has_g).mean():.0%}, neighbours of genome films "
        f"{nn_imputed[has_g[sample]].mean():.0%}, neighbours of imputed films {nn_imputed[~has_g[sample]].mean():.0%}"
    )

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
    inv = 1 / np.linalg.norm(q.astype(np.float32), axis=1)
    err = np.abs(np.sum((q[:500].astype(np.float32) * inv[:500, None]) * Z[:500], axis=1) - 1).max()
    log(f"int8 scale={1 / s:.5f}, worst self-cosine error over 500 rows={err:.4f}")

    np.savez(WORK / "pca.npz", mean=pca.mean_, components=pca.components_, scale=1 / s)
    # The monthly job imputes new films against the same reference set, so keep it.
    np.savez_compressed(
        WORK / "genome_knn.npz", ref_feats=f_g.astype(np.float16), ref_genome=G_real.astype(np.float16),
        plot_mean=plot_mean, genome_mean=genome_mean, k=IMPUTE_K, temp=IMPUTE_TEMP, weight_genome=WEIGHT_GENOME,
    )

    # Published files.
    (OUT / "vectors.i8").write_bytes(q.tobytes())
    years = movies["release_date"].str.slice(0, 4).cast(pl.Int32, strict=False).fill_null(0)
    bits = (genres * (1 << np.arange(len(GENRES)))).sum(axis=1)
    catalogue = {
        "tmdb": movies["id"].to_list(),
        "title": movies["title"].to_list(),
        "year": years.to_list(),
        "genres": [int(b) for b in bits],
        "pop": [round(p, 2) for p in movies["popularity"].fill_null(0).to_list()],
        "votes": [int(v) for v in movies["vote_count"].to_list()],
        "rating": [round(r, 1) for r in movies["vote_average"].fill_null(0).to_list()],
        "poster": movies["poster_path"].to_list(),
        "genome": [int(b) for b in has_g],
        "director": movies["director"].to_list(),
    }
    cat_bytes = json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")).encode()
    (OUT / "catalogue.json").write_bytes(cat_bytes)
    manifest = {
        "version": data_version(q.tobytes(), cat_bytes), "count": n, "dims": DIMS, "scale": 1 / s,
        "genres": GENRES,
        # Only files that exist. `extras` (task 7) adds onboarding.json and a new version.
        "files": {"vectors": "vectors.i8", "catalogue": "catalogue.json"},
        "bytes": {"vectors": q.nbytes, "catalogue": len(cat_bytes)},
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    log(
        f"wrote vectors.i8 ({q.nbytes / 1e6:.1f} MB), catalogue.json ({len(cat_bytes) / 1e6:.1f} MB, "
        f"{len(gzip.compress(cat_bytes)) / 1e6:.1f} MB gzipped), manifest.json"
    )
    log(f"data version {manifest['version']} → publish as release data-{manifest['version']}")

    # Sanity check, decoded from the file just written.
    q_file = np.frombuffer((OUT / "vectors.i8").read_bytes(), dtype=np.int8).reshape(n, DIMS)
    titles = catalogue["title"]
    for tmdb_id in CHECK_FILMS:
        row = catalogue["tmdb"].index(tmdb_id)
        log(f"nearest to {titles[row]}: " + "; ".join(neighbours(q_file, inv, titles, row)))


STAGES = {"join": stage_join, "embed": stage_embed, "vectors": stage_vectors}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", choices=[*STAGES, "all"], required=True)
    args = ap.parse_args()
    for name, fn in STAGES.items():
        if args.stage in (name, "all"):
            log(f"── stage {name}")
            fn()
