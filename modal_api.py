"""Read-only EgoPrism summary API backed by the persistent Modal volume.

Deploy with:
    modal deploy modal_api.py
"""

from __future__ import annotations

from pathlib import Path

import modal

PACKAGES = [
    "fastapi==0.116.1",
    "numpy==2.2.6",
    "pandas==2.2.3",
    "pyarrow==19.0.1",
    "scikit-learn==1.6.1",
]

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(*PACKAGES)
    .add_local_dir("src", remote_path="/root/egoprism/src")
)

app = modal.App("egoprism-api", image=image)
data_vol = modal.Volume.from_name("egoverse-data", create_if_missing=True)
DATA = "/data"


@app.function(volumes={DATA: data_vol}, timeout=90, cpu=1.0, memory=2048)
@modal.fastapi_endpoint(method="GET")
def summary():
    import sys

    from fastapi import HTTPException
    from fastapi.responses import JSONResponse
    import pandas as pd

    sys.path.insert(0, "/root/egoprism")
    from src.web_payload import comparison_payload

    data_vol.reload()
    parquet_path = Path(DATA) / "artifacts" / "features.parquet"
    if not parquet_path.exists():
        raise HTTPException(
            status_code=503,
            detail="Feature cache is not ready. Run modal_extract.py first.",
        )
    payload = comparison_payload(pd.read_parquet(parquet_path), source="modal")
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "public, max-age=60, stale-while-revalidate=300"},
    )
