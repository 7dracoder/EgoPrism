from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from src.metrics import ComparisonResult, SubsetScore, score_comparison


def _number(value: Any, digits: int = 6) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if np.isfinite(number) else None


def _subset_payload(
    score: SubsetScore,
    labeled: pd.DataFrame,
    subset: str,
) -> dict[str, Any]:
    part = labeled[labeled["subset"] == subset]
    idle = part["idle_frac"].dropna().to_numpy(dtype=float)
    return {
        "name": subset,
        "score": _number(score.score, 4),
        "ci": [_number(score.ci_low, 4), _number(score.ci_high, 4)],
        "episodes": int(score.n_episodes),
        "scenes": int(part["scene"].nunique()),
        "labs": int(part["lab"].nunique()),
        "durationSeconds": _number(part["duration_s"].sum(), 3),
        "visualEntropy": _number(score.visual_entropy, 6),
        "motionEntropy": _number(score.motion_entropy, 6),
        "visualClustersUsed": int(score.n_visual_clusters_used),
        "motionClustersUsed": int(score.n_motion_clusters_used),
        "visualOccupancy": [
            {"cluster": int(cluster), "count": int(count)}
            for cluster, count in sorted(score.visual_occupancy.items())
        ],
        "motionOccupancy": [
            {"cluster": int(cluster), "count": int(count)}
            for cluster, count in sorted(score.motion_occupancy.items())
        ],
        "medianIdleFraction": _number(np.median(idle), 6) if len(idle) else None,
    }


def comparison_payload(
    features: pd.DataFrame,
    *,
    source: str = "modal",
) -> dict[str, Any]:
    result: ComparisonResult = score_comparison(features)
    labeled = result.labeled.sort_values(["subset", "episode_id"]).copy()
    episodes = []
    for row in labeled.itertuples(index=False):
        preview = getattr(row, "preview_path", "")
        if not isinstance(preview, str) or not preview:
            preview = f"/episodes/{row.episode_id}.jpg"
        elif preview.startswith("artifacts/previews/"):
            preview = f"/episodes/{preview.rsplit('/', 1)[-1]}"
        episodes.append(
            {
                "id": str(row.episode_id),
                "subset": str(row.subset),
                "lab": str(row.lab),
                "scene": str(row.scene),
                "source": str(getattr(row, "source", row.lab)),
                "task": str(getattr(row, "episode_task", row.task)),
                "durationSeconds": _number(row.duration_s, 3),
                "visualCluster": int(row.visual_cluster),
                "motionCluster": int(row.motion_cluster),
                "x": _number(row.x, 6),
                "y": _number(row.y, 6),
                "novelty": _number(row.novelty, 6),
                "idleFraction": _number(row.idle_frac, 6),
                "preview": preview,
            }
        )

    return {
        "project": "EgoPrism",
        "source": source,
        "task": result.task,
        "quality": result.data_quality,
        "winner": result.winner,
        "statement": result.statement,
        "notes": list(result.notes),
        "clusterCount": int(result.k),
        "visualOnly": bool(result.visual_only),
        "subsetA": _subset_payload(result.subset_a, labeled, "A"),
        "subsetB": _subset_payload(result.subset_b, labeled, "B"),
        "episodes": episodes,
        "method": {
            "visualWeight": 0.5 if not result.visual_only else 1.0,
            "motionWeight": 0.0 if result.visual_only else 0.5,
            "bootstrapSamples": 200,
            "confidenceLevel": 0.95,
            "minimumWinnerGap": 2.0,
            "idleSpeedThresholdMps": 0.02,
        },
    }
