from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from src.schemas import CLUSTER_K_CAP, MOTION_COLUMNS, N_BOOTSTRAP, RNG_SEED


@dataclass
class SubsetScore:
    name: str
    score: float
    ci_low: float
    ci_high: float
    visual_entropy: float
    motion_entropy: float | None
    n_episodes: int
    n_visual_clusters_used: int
    n_motion_clusters_used: int
    visual_occupancy: dict[int, int]
    motion_occupancy: dict[int, int]


@dataclass
class ComparisonResult:
    task: str
    subset_a: SubsetScore
    subset_b: SubsetScore
    winner: str
    statement: str
    data_quality: str
    k: int
    duration_imbalance: bool
    count_imbalance: bool
    visual_only: bool
    notes: list[str] = field(default_factory=list)
    labeled: Any = None


def choose_k(n: int, cap: int = CLUSTER_K_CAP) -> int:
    if n < 2:
        return 1
    return int(min(cap, max(2, np.floor(np.sqrt(n)))))


def normalized_entropy(labels: np.ndarray, k: int) -> float:
    if k <= 1 or len(labels) == 0:
        return 0.0
    counts = np.bincount(labels, minlength=k).astype(np.float64)
    total = counts.sum()
    if total <= 0:
        return 0.0
    p = counts / total
    p = p[p > 0]
    return float(max(0.0, -(p * np.log(p)).sum() / np.log(k)))


def _cluster(x: np.ndarray, k: int, seed: int) -> np.ndarray:
    import warnings

    if len(x) == 0 or k <= 1:
        return np.zeros(len(x), dtype=np.int64)
    k = min(k, len(x))
    model = KMeans(n_clusters=k, n_init=10, random_state=seed)
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message="Could not find the number of physical cores.*",
            category=UserWarning,
        )
        return model.fit_predict(x).astype(np.int64)


def _bootstrap_entropy(labels: np.ndarray, k: int, rng: np.random.Generator, n: int) -> np.ndarray:
    out = np.zeros(n, dtype=np.float64)
    if len(labels) == 0:
        return out
    for i in range(n):
        sample = rng.choice(labels, size=len(labels), replace=True)
        out[i] = normalized_entropy(sample, k)
    return out


def _stack_embeddings(series: pd.Series) -> np.ndarray:
    return np.vstack(series.to_list()).astype(np.float64)


def _motion_matrix(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    present = frame["has_motion"].to_numpy().astype(bool)
    cols = [c for c in MOTION_COLUMNS if c in frame.columns]
    raw = frame[cols].to_numpy(dtype=np.float64)
    raw = np.where(np.isfinite(raw), raw, np.nan)
    med = np.nanmedian(raw, axis=0)
    med = np.where(np.isfinite(med), med, 0.0)
    usable_cols = np.isfinite(raw).mean(axis=0) >= 0.5
    if usable_cols.any():
        raw = raw[:, usable_cols]
        med = med[usable_cols]
        # Sensor dropouts can leave finite but physically impossible pose jumps.
        # Winsorize only after pooling A+B so both subsets receive the same
        # robust transform and a handful of glitches cannot define a cluster.
        lo = np.nanquantile(raw, 0.005, axis=0)
        hi = np.nanquantile(raw, 0.995, axis=0)
        filled = np.where(np.isfinite(raw), raw, med)
        filled = np.clip(filled, lo, hi)
    else:
        filled = np.zeros((len(frame), 1))
    return filled, present


def score_comparison(
    features: pd.DataFrame,
    *,
    seed: int = RNG_SEED,
    n_bootstrap: int = N_BOOTSTRAP,
) -> ComparisonResult:
    _validate_features(features)
    tasks = sorted(features["task"].dropna().unique().tolist())
    task = tasks[0] if tasks else "unknown"
    n = len(features)
    k = choose_k(n)
    visual_only = not bool(features["has_motion"].any())

    scaler_v = StandardScaler()
    vis = scaler_v.fit_transform(_stack_embeddings(features["visual_embedding"]))
    vis_labels = _cluster(vis, k, seed)

    mot, mot_mask = _motion_matrix(features)
    scaler_m = StandardScaler()
    mot_labels = np.full(n, -1, dtype=np.int64)
    motion_k = k
    if mot_mask.sum() >= k and not visual_only:
        mot_std = scaler_m.fit_transform(mot[mot_mask])
        mot_labels[mot_mask] = _cluster(mot_std, k, seed + 1)
    else:
        visual_only = True
        motion_k = 0

    novelty = _novelty(vis, vis_labels)
    labeled = features.copy()
    labeled["visual_cluster"] = vis_labels
    labeled["motion_cluster"] = mot_labels
    labeled["novelty"] = novelty
    # umap coords attached later by caller; keep deterministic 2-d PCA here
    labeled["x"], labeled["y"] = _embed2d(vis, seed)

    a = labeled[labeled["subset"] == "A"]
    b = labeled[labeled["subset"] == "B"]
    rng = np.random.default_rng(seed)

    def _score(part: pd.DataFrame, name: str) -> SubsetScore:
        v_ent = normalized_entropy(part["visual_cluster"].to_numpy(), k)
        v_boot = _bootstrap_entropy(part["visual_cluster"].to_numpy(), k, rng, n_bootstrap)
        if visual_only:
            m_ent = None
            scores = 100.0 * v_boot
            point = 100.0 * v_ent
            m_occ: dict[int, int] = {}
        else:
            m_labs = part.loc[part["motion_cluster"] >= 0, "motion_cluster"].to_numpy()
            m_ent = normalized_entropy(m_labs, k)
            m_boot = _bootstrap_entropy(m_labs, k, rng, n_bootstrap)
            scores = 50.0 * v_boot + 50.0 * m_boot
            point = 50.0 * v_ent + 50.0 * m_ent
            m_occ = _occupancy(m_labs, k)
        lo, hi = np.quantile(scores, [0.025, 0.975])
        return SubsetScore(
            name=name,
            score=float(point),
            ci_low=float(lo),
            ci_high=float(hi),
            visual_entropy=float(v_ent),
            motion_entropy=None if m_ent is None else float(m_ent),
            n_episodes=len(part),
            n_visual_clusters_used=int(part["visual_cluster"].nunique()),
            n_motion_clusters_used=(
                0
                if visual_only
                else int(part.loc[part["motion_cluster"] >= 0, "motion_cluster"].nunique())
            ),
            visual_occupancy=_occupancy(part["visual_cluster"].to_numpy(), k),
            motion_occupancy=m_occ,
        )

    sa = _score(a, "A")
    sb = _score(b, "B")
    overlap = sa.ci_high >= sb.ci_low and sb.ci_high >= sa.ci_low
    delta = abs(sb.score - sa.score)
    if overlap or delta < 2.0:
        winner = "tie"
        statement = "No clear difference — confidence intervals overlap or the gap is small."
    elif sb.score > sa.score:
        winner = "B"
        statement = (
            "Subset B covers more distinct visual contexts and manipulation patterns than subset A."
        )
    else:
        winner = "A"
        statement = (
            "Subset A covers more distinct visual contexts and manipulation patterns than subset B."
        )

    count_imbalance = _imbalanced(sa.n_episodes, sb.n_episodes, 0.10)
    dur_a = float(a["duration_s"].sum()) if len(a) else 0.0
    dur_b = float(b["duration_s"].sum()) if len(b) else 0.0
    duration_imbalance = _imbalanced(dur_a, dur_b, 0.20)

    notes = []
    if count_imbalance:
        notes.append(f"Episode counts differ (A={sa.n_episodes}, B={sb.n_episodes}).")
    if duration_imbalance:
        notes.append(f"Total duration differs (A={dur_a:.1f}s, B={dur_b:.1f}s).")
    if visual_only:
        notes.append("Motion unused — score is visual entropy only.")

    quality = "visual only" if visual_only else "visual + motion"
    result = ComparisonResult(
        task=task,
        subset_a=sa,
        subset_b=sb,
        winner=winner,
        statement=statement,
        data_quality=quality,
        k=k,
        duration_imbalance=duration_imbalance,
        count_imbalance=count_imbalance,
        visual_only=visual_only,
        notes=notes,
        labeled=labeled,
    )
    return result


def _validate_features(features: pd.DataFrame) -> None:
    if features.empty:
        raise ValueError("no episode features to score")
    required = {
        "episode_id",
        "subset",
        "task",
        "duration_s",
        "visual_embedding",
        "has_motion",
    }
    missing = sorted(required - set(features.columns))
    if missing:
        raise ValueError(f"feature cache missing columns: {missing}")
    subsets = set(features["subset"].dropna().astype(str))
    if subsets != {"A", "B"}:
        raise ValueError(f"feature cache must contain subsets A and B, got {sorted(subsets)}")
    counts = features.groupby("subset").size()
    if (counts < 2).any():
        raise ValueError("each subset needs at least two episodes")
    tasks = features["task"].dropna().astype(str).unique().tolist()
    if len(tasks) != 1:
        raise ValueError(f"subsets must share one task, got {sorted(tasks)}")
    if features["episode_id"].astype(str).duplicated().any():
        raise ValueError("episode IDs must be unique")
    embeddings = [np.asarray(value, dtype=np.float64) for value in features["visual_embedding"]]
    dimensions = {value.shape for value in embeddings}
    if len(dimensions) != 1 or not embeddings or len(embeddings[0].shape) != 1:
        raise ValueError("visual embeddings must be one-dimensional and share a dimension")
    if not all(value.size > 0 and np.isfinite(value).all() for value in embeddings):
        raise ValueError("visual embeddings must be non-empty and finite")


def _occupancy(labels: np.ndarray, k: int) -> dict[int, int]:
    counts = np.bincount(labels[labels >= 0], minlength=k)
    return {int(i): int(c) for i, c in enumerate(counts)}


def _imbalanced(a: float, b: float, frac: float) -> bool:
    denom = max(a, b, 1e-9)
    return abs(a - b) / denom > frac


def _novelty(vis: np.ndarray, labels: np.ndarray) -> np.ndarray:
    out = np.zeros(len(vis), dtype=np.float64)
    for c in np.unique(labels):
        mask = labels == c
        centroid = vis[mask].mean(axis=0)
        out[mask] = np.linalg.norm(vis[mask] - centroid, axis=1)
    return out


def _embed2d(vis: np.ndarray, seed: int) -> tuple[np.ndarray, np.ndarray]:
    import warnings

    from sklearn.decomposition import PCA

    n_comp = int(min(16, vis.shape[0], vis.shape[1]))
    n_comp = max(n_comp, 1)
    reduced = PCA(
        n_components=n_comp,
        random_state=seed,
        svd_solver="full",
    ).fit_transform(vis)
    if reduced.shape[1] == 1:
        return reduced[:, 0], np.zeros(len(reduced), dtype=np.float64)
    try:
        from umap import UMAP

        neighbors = max(2, min(12, len(reduced) - 1))
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=".*force_all_finite.*",
                category=FutureWarning,
            )
            xy = UMAP(
                n_components=2,
                n_neighbors=neighbors,
                min_dist=0.25,
                metric="euclidean",
                random_state=seed,
                init="random",
                n_jobs=1,
            ).fit_transform(reduced)
        if np.isfinite(xy).all():
            return xy[:, 0], xy[:, 1]
    except Exception:
        pass
    return reduced[:, 0], reduced[:, 1]
