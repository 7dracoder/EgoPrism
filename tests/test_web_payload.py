import json

from src.pipeline import run_extraction
from src.synth import write_demo_subsets
from src.web_payload import comparison_payload


def test_web_payload_is_serializable_and_evidence_backed(tmp_path):
    write_demo_subsets(
        episode_dir=tmp_path / "data" / "episodes",
        manifest_dir=tmp_path / "data" / "manifests",
        n_per_subset=3,
    )
    features = run_extraction(
        manifest_a=tmp_path / "data" / "manifests" / "subset_a.csv",
        manifest_b=tmp_path / "data" / "manifests" / "subset_b.csv",
        project_root=tmp_path,
        out_parquet=tmp_path / "features.parquet",
        preview_dir=tmp_path / "previews",
    )
    payload = comparison_payload(features, source="test")

    assert payload["source"] == "test"
    assert payload["subsetA"]["episodes"] == 3
    assert payload["subsetB"]["episodes"] == 3
    assert len(payload["episodes"]) == 6
    assert {episode["subset"] for episode in payload["episodes"]} == {"A", "B"}
    assert all(episode["preview"].endswith(".jpg") for episode in payload["episodes"])
    json.dumps(payload)
