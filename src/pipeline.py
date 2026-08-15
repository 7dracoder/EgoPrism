from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.features import extract_episode
from src.io import load_manifest
from src.metrics import score_comparison
from src.paths import ARTIFACT_DIR, FEATURE_PARQUET, MANIFEST_DIR, ROOT, SCORE_JSON
from src.schemas import EpisodeValidationError


def run_extraction(
    *,
    manifest_a: Path | None = None,
    manifest_b: Path | None = None,
    project_root: Path | None = None,
    out_parquet: Path | None = None,
    preview_dir: Path | None = None,
) -> pd.DataFrame:
    root = project_root or ROOT
    manifest_a = manifest_a or MANIFEST_DIR / "subset_a.csv"
    manifest_b = manifest_b or MANIFEST_DIR / "subset_b.csv"
    rows = load_manifest(manifest_a, "A") + load_manifest(manifest_b, "B")
    tasks = {r.task for r in rows}
    if len(tasks) != 1:
        raise EpisodeValidationError(f"subsets must share one task, got {sorted(tasks)}")
    episode_ids = [r.episode_id for r in rows]
    duplicates = sorted({episode_id for episode_id in episode_ids if episode_ids.count(episode_id) > 1})
    if duplicates:
        raise EpisodeValidationError(
            f"episode IDs must be unique across both subsets: {duplicates}"
        )
    records = [
        extract_episode(row, project_root=root, preview_dir=preview_dir).to_row()
        for row in rows
    ]
    frame = pd.DataFrame.from_records(records)
    dest = out_parquet or FEATURE_PARQUET
    dest.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(dest, index=False)
    return frame


def load_features(path: Path | None = None) -> pd.DataFrame:
    path = path or FEATURE_PARQUET
    if not path.exists():
        raise FileNotFoundError(f"missing feature cache: {path}")
    frame = pd.read_parquet(path)
    if "visual_embedding" in frame.columns:
        frame["visual_embedding"] = frame["visual_embedding"].map(_as_list)
    return frame


def _as_list(value):
    if isinstance(value, list):
        return value
    return list(value)


def compare_cached(path: Path | None = None):
    features = load_features(path)
    result = score_comparison(features)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    SCORE_JSON.write_text(_result_json(result))
    return result


def _result_json(result) -> str:
    import json

    payload = {
        "task": result.task,
        "winner": result.winner,
        "statement": result.statement,
        "data_quality": result.data_quality,
        "k": result.k,
        "visual_only": result.visual_only,
        "notes": result.notes,
        "subset_a": _score_dict(result.subset_a),
        "subset_b": _score_dict(result.subset_b),
    }
    return json.dumps(payload, indent=2)


def _score_dict(score) -> dict:
    return {
        "score": score.score,
        "ci_low": score.ci_low,
        "ci_high": score.ci_high,
        "visual_entropy": score.visual_entropy,
        "motion_entropy": score.motion_entropy,
        "n_episodes": score.n_episodes,
        "visual_occupancy": score.visual_occupancy,
        "motion_occupancy": score.motion_occupancy,
    }
