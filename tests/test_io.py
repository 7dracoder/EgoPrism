from pathlib import Path

import pytest
import zarr

from src.io import open_episode, validate_episode
from src.schemas import EpisodeValidationError
from src.synth import write_demo_subsets, write_invalid_episode


def test_valid_episode_has_intrinsics_and_front_camera(tmp_path: Path):
    write_demo_subsets(
        episode_dir=tmp_path / "episodes",
        manifest_dir=tmp_path / "manifests",
        n_per_subset=1,
    )
    store = open_episode(tmp_path / "episodes" / "fold_a_001.zarr")
    attrs = validate_episode(store, expected_task="fold-clothes")
    assert attrs["embodiment"] == "human_bimanual"
    assert "images.front_1" in store
    assert Path(tmp_path / "episodes" / "fold_a_001.zarr" / "zarr.json").exists()


def test_rejects_stale_vendor_embodiment(tmp_path: Path):
    dest = write_invalid_episode(tmp_path / "bad.zarr", "bad_embodiment")
    store = zarr.open_group(str(dest), mode="r")
    with pytest.raises(EpisodeValidationError, match="invalid embodiment"):
        validate_episode(store)


def test_rejects_missing_intrinsics(tmp_path: Path):
    dest = write_invalid_episode(tmp_path / "no_k.zarr", "missing_intrinsics")
    store = zarr.open_group(str(dest), mode="r")
    with pytest.raises(EpisodeValidationError, match="intrinsics"):
        validate_episode(store)


def test_rejects_missing_front_camera(tmp_path: Path):
    dest = write_invalid_episode(tmp_path / "no_img.zarr", "missing_images")
    store = zarr.open_group(str(dest), mode="r")
    with pytest.raises(EpisodeValidationError, match="images.front_1"):
        validate_episode(store)
