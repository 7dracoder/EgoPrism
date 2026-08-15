from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.metrics import _motion_matrix, choose_k, normalized_entropy, score_comparison


def _subset(
    name: str,
    n: int,
    *,
    n_modes: int,
    spread: float,
    seed: int,
    motion_spread: float,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    modes = rng.normal(size=(n_modes, 16))
    vis = np.stack([modes[i % n_modes] + rng.normal(0, spread, size=16) for i in range(n)])
    motion = rng.normal(0, motion_spread, size=(n, 4)) + np.array([0.2, 0.2, 0.1, 0.5])
    rows = []
    for i in range(n):
        rows.append(
            {
                "episode_id": f"{name}_{i:03d}",
                "subset": name,
                "task": "fold-clothes",
                "lab": "lab_a",
                "scene": f"scene_{(i % n_modes) + 1:02d}",
                "fps": 30,
                "n_frames": 90,
                "duration_s": 3.0,
                "visual_embedding": vis[i].tolist(),
                "has_visual": True,
                "has_motion": True,
                "left_traj_m": abs(float(motion[i, 0])),
                "right_traj_m": abs(float(motion[i, 1])),
                "ee_speed_median": abs(float(motion[i, 2])),
                "ee_speed_p90": abs(float(motion[i, 2])) * 1.4,
                "idle_frac": float(np.clip(motion[i, 3], 0, 1)),
                "head_translation_m": 0.1 * motion_spread,
                "head_rotation_rad": 0.2 * motion_spread,
                "bimanual_speed_corr": 0.8 if name == "A" else 0.2,
            }
        )
    return pd.DataFrame(rows)


def test_choose_k():
    assert choose_k(1) == 1
    assert choose_k(16) == 4
    assert choose_k(100) == 8


def test_uniform_entropy_is_one():
    labels = np.array([0, 1, 2, 3, 0, 1, 2, 3])
    assert normalized_entropy(labels, 4) == 1.0


def test_peaked_entropy_is_low():
    labels = np.zeros(16, dtype=int)
    assert normalized_entropy(labels, 4) == 0.0


def test_broad_subset_outranks_narrow():
    a = _subset("A", 16, n_modes=1, spread=0.02, seed=1, motion_spread=0.01)
    b = _subset("B", 16, n_modes=8, spread=0.05, seed=2, motion_spread=0.4)
    result = score_comparison(pd.concat([a, b], ignore_index=True), n_bootstrap=80)
    assert result.winner == "B"
    assert result.subset_b.score > result.subset_a.score
    assert result.subset_b.ci_low > result.subset_a.ci_high


def test_identical_subsets_are_a_tie():
    a = _subset("A", 12, n_modes=3, spread=0.08, seed=3, motion_spread=0.1)
    b = a.copy()
    b["subset"] = "B"
    b["episode_id"] = "B_" + b["episode_id"].str.slice(2)
    result = score_comparison(pd.concat([a, b], ignore_index=True), n_bootstrap=80)
    assert result.winner == "tie"
    assert "No clear difference" in result.statement


def test_rejects_missing_subset():
    a = _subset("A", 4, n_modes=2, spread=0.02, seed=4, motion_spread=0.1)
    with pytest.raises(ValueError, match="subsets A and B"):
        score_comparison(a, n_bootstrap=10)


def test_rejects_mixed_tasks():
    a = _subset("A", 4, n_modes=2, spread=0.02, seed=5, motion_spread=0.1)
    b = _subset("B", 4, n_modes=2, spread=0.02, seed=6, motion_spread=0.1)
    b["task"] = "bag-grocery"
    with pytest.raises(ValueError, match="share one task"):
        score_comparison(pd.concat([a, b], ignore_index=True), n_bootstrap=10)


def test_motion_matrix_contains_finite_sensor_glitches():
    frame = pd.DataFrame(
        {
            "has_motion": [True] * 1_000,
            "left_traj_m": [1.0] * 999 + [1e12],
            "right_traj_m": [1.0] * 1_000,
            "ee_speed_median": [0.1] * 1_000,
            "ee_speed_p90": [0.2] * 1_000,
            "idle_frac": [0.1] * 1_000,
            "head_translation_m": [0.2] * 1_000,
            "head_rotation_rad": [0.3] * 1_000,
            "bimanual_speed_corr": [0.5] * 1_000,
        }
    )
    matrix, present = _motion_matrix(frame)
    assert present.all()
    assert matrix[:, 0].max() < 1e12
