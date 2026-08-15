from pathlib import Path

from src.synth import DEMO_MARKER, demo_fixture_needs_refresh, write_demo_subsets


def test_demo_fixture_version_is_current_after_generation(tmp_path: Path):
    episodes = tmp_path / "episodes"
    manifests = tmp_path / "manifests"
    write_demo_subsets(
        episode_dir=episodes,
        manifest_dir=manifests,
        n_per_subset=1,
    )

    assert not demo_fixture_needs_refresh(
        episode_dir=episodes,
        manifest_dir=manifests,
        n_per_subset=1,
    )

    (episodes / DEMO_MARKER).write_text("stale\n", encoding="utf-8")
    assert demo_fixture_needs_refresh(
        episode_dir=episodes,
        manifest_dir=manifests,
        n_per_subset=1,
    )


def test_unknown_volume_data_is_not_treated_as_demo(tmp_path: Path):
    episodes = tmp_path / "episodes"
    episodes.mkdir()
    (episodes / "customer_capture.zarr").mkdir()

    assert not demo_fixture_needs_refresh(
        episode_dir=episodes,
        manifest_dir=tmp_path / "manifests",
    )
