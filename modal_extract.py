"""Extract EgoPrism features on Modal CPU.

Default path is CPU-only. GPU embedding generation is a separate function
and is not invoked unless stored DINO embeddings are missing.

  modal run modal_extract.py
"""

from __future__ import annotations

from pathlib import Path

import modal

PACKAGES = [
    "numpy==2.2.6",
    "pandas==2.2.3",
    "pyarrow==19.0.1",
    "zarr==3.1.2",
    "numcodecs==0.16.2",
    "scikit-learn==1.6.1",
    "pillow==11.2.1",
]

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(*PACKAGES)
    .add_local_dir("src", remote_path="/root/egoprism/src")
)

app = modal.App("egoprism", image=image)
data_vol = modal.Volume.from_name("egoverse-data", create_if_missing=True)
DATA = "/data"


@app.function(volumes={DATA: data_vol}, timeout=900, cpu=2.0, memory=4096)
def extract_on_volume() -> dict:
    import sys

    sys.path.insert(0, "/root/egoprism")

    from src.metrics import score_comparison
    from src.pipeline import run_extraction
    from src.synth import demo_fixture_needs_refresh, write_demo_subsets

    root = Path(DATA)
    episode_dir = root / "episodes"
    manifest_dir = root / "manifests"
    preview_dir = root / "artifacts" / "previews"
    parquet_path = root / "artifacts" / "features.parquet"
    if demo_fixture_needs_refresh(episode_dir=episode_dir, manifest_dir=manifest_dir):
        write_demo_subsets(episode_dir=episode_dir, manifest_dir=manifest_dir)
    frame = run_extraction(
        manifest_a=manifest_dir / "subset_a.csv",
        manifest_b=manifest_dir / "subset_b.csv",
        project_root=Path("/"),
        out_parquet=parquet_path,
        preview_dir=preview_dir,
    )
    result = score_comparison(frame)
    previews = {p.name: p.read_bytes() for p in preview_dir.glob("*.jpg")}
    data_vol.commit()
    return {
        "n": int(len(frame)),
        "winner": result.winner,
        "statement": result.statement,
        "score_a": result.subset_a.score,
        "score_b": result.subset_b.score,
        "ci_a": [result.subset_a.ci_low, result.subset_a.ci_high],
        "ci_b": [result.subset_b.ci_low, result.subset_b.ci_high],
        "data_quality": result.data_quality,
        "parquet": parquet_path.read_bytes(),
        "previews": previews,
    }


@app.function(gpu="T4", timeout=300)
def gpu_ready() -> dict:
    """Optional probe. Default scoring does not call this."""
    import os

    return {"cuda_visible": os.environ.get("CUDA_VISIBLE_DEVICES"), "used": False}


@app.local_entrypoint()
def main():
    result = extract_on_volume.remote()
    artifacts = Path("artifacts")
    previews = artifacts / "previews"
    artifacts.mkdir(exist_ok=True)
    previews.mkdir(parents=True, exist_ok=True)
    (artifacts / "features.parquet").write_bytes(result["parquet"])
    for name, blob in result["previews"].items():
        (previews / name).write_bytes(blob)
    print("extracted", result["n"], "episodes")
    print(
        f"A={result['score_a']:.1f} {result['ci_a']}  "
        f"B={result['score_b']:.1f} {result['ci_b']}"
    )
    print("winner", result["winner"])
    print(result["statement"])
    print("wrote artifacts/features.parquet")
