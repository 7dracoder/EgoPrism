from pathlib import Path

import numpy as np
import pandas as pd

from src.features import extract_episode
from src.pipeline import run_extraction
from src.synth import write_demo_subsets


def test_one_row_per_episode_and_deterministic(tmp_path: Path):
    write_demo_subsets(
        episode_dir=tmp_path / "data" / "episodes",
        manifest_dir=tmp_path / "data" / "manifests",
        n_per_subset=3,
    )
    first = run_extraction(
        manifest_a=tmp_path / "data" / "manifests" / "subset_a.csv",
        manifest_b=tmp_path / "data" / "manifests" / "subset_b.csv",
        project_root=tmp_path,
        out_parquet=tmp_path / "features.parquet",
        preview_dir=tmp_path / "previews",
    )
    second = run_extraction(
        manifest_a=tmp_path / "data" / "manifests" / "subset_a.csv",
        manifest_b=tmp_path / "data" / "manifests" / "subset_b.csv",
        project_root=tmp_path,
        out_parquet=tmp_path / "features2.parquet",
        preview_dir=tmp_path / "previews2",
    )
    assert len(first) == 6
    assert set(first["episode_id"]) == set(second["episode_id"])
    a = np.stack(first.sort_values("episode_id")["visual_embedding"].to_list())
    b = np.stack(second.sort_values("episode_id")["visual_embedding"].to_list())
    np.testing.assert_allclose(a, b, rtol=1e-6, atol=1e-6)
    for col in ("left_traj_m", "idle_frac", "head_translation_m"):
        np.testing.assert_allclose(
            first.sort_values("episode_id")[col].to_numpy(),
            second.sort_values("episode_id")[col].to_numpy(),
            rtol=1e-6,
            atol=1e-6,
        )
    assert first["has_visual"].all()
    assert first["has_motion"].all()
    assert first["visual_source"].eq("dino.front_img_1").all()


def test_missing_motion_is_recorded(tmp_path: Path):
    from src.synth import _scene_centroids, _write_episode
    from src.schemas import ManifestRow

    rng = np.random.default_rng(0)
    dest = tmp_path / "data" / "episodes" / "fold_a_001.zarr"
    dest.parent.mkdir(parents=True)
    _write_episode(
        dest,
        rng,
        scene="scene_01",
        lab="lab_a",
        centroid=_scene_centroids(rng)["scene_01"],
        narrow=True,
        episode_index=0,
        include_motion=False,
    )
    row = ManifestRow(
        episode_id="fold_a_001",
        zarr_path="data/episodes/fold_a_001.zarr",
        task="fold-clothes",
        lab="lab_a",
        scene="scene_01",
        fps=30,
        subset="A",
    )
    feat = extract_episode(row, project_root=tmp_path, preview_dir=tmp_path / "previews")
    assert feat.has_visual
    assert not feat.motion.has_motion
    assert feat.motion.left_traj_m is None
    assert feat.motion.idle_frac is None
