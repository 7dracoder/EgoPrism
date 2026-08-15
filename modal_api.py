"""Read-only EgoPrism summary API backed by the persistent Modal volume.

Deploy with:
    modal deploy modal_api.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re

import modal

PACKAGES = [
    "fastapi==0.116.1",
    "numpy==2.2.6",
    "pandas==2.2.3",
    "pyarrow==19.0.1",
    "scikit-learn==1.6.1",
    "s3fs==2025.7.0",
    "zarr==3.1.2",
    "numcodecs==0.16.2",
    "pillow==11.2.1",
]

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(*PACKAGES)
    .add_local_dir("src", remote_path="/root/egoprism/src")
)

app = modal.App("egoprism-api", image=image)
data_vol = modal.Volume.from_name("egoverse-data", create_if_missing=True)
preview_cache = modal.Dict.from_name("egoprism-preview-cache", create_if_missing=True)
r2_secret = modal.Secret.from_name("egoverse-r2")
DATA = "/data"
VALID_SOURCES = frozenset({"aria", "eva", "scale"})
EPISODE_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,96}$")


def _remote_group(uri: str):
    import zarr

    endpoint = (
        os.environ.get("R2_ENDPOINT_URL")
        or os.environ.get("AWS_ENDPOINT_URL_S3")
        or os.environ.get("S3_ENDPOINT_URL")
    )
    store = zarr.storage.FsspecStore.from_url(
        uri,
        storage_options={
            "key": os.environ["R2_ACCESS_KEY_ID"],
            "secret": os.environ["R2_SECRET_ACCESS_KEY"],
            "client_kwargs": {"endpoint_url": endpoint, "region_name": "auto"},
            "config_kwargs": {"signature_version": "s3v4"},
            "default_fill_cache": False,
        },
        read_only=True,
    )
    return zarr.open_group(store=store, mode="r")


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
    prepared_summary = Path(DATA) / "artifacts" / "real-summary.json"
    payload = (
        json.loads(prepared_summary.read_text())
        if prepared_summary.exists()
        else comparison_payload(pd.read_parquet(parquet_path), source="modal")
    )
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "public, max-age=60, stale-while-revalidate=300"},
    )


@app.function(
    secrets=[r2_secret],
    volumes={DATA: data_vol},
    timeout=90,
    cpu=1.0,
    memory=2048,
)
@modal.fastapi_endpoint(method="GET")
def preview(source: str, episode_id: str):
    import io

    from fastapi import HTTPException
    from fastapi.responses import Response
    import numpy as np
    import pandas as pd
    from PIL import Image

    if source not in VALID_SOURCES or not EPISODE_ID_RE.fullmatch(episode_id):
        raise HTTPException(status_code=400, detail="Invalid episode identifier.")

    cache_key = f"{source}:{episode_id}"
    data_vol.reload()
    allowlist_path = Path(DATA) / "artifacts" / "public_preview_allowlist.txt"
    if not allowlist_path.exists():
        raise HTTPException(status_code=403, detail="Public episode previews are disabled.")
    allowed = {
        line.strip()
        for line in allowlist_path.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    if "*" not in allowed and cache_key not in allowed:
        raise HTTPException(status_code=403, detail="This episode is not cleared for public preview.")

    cached = preview_cache.get(cache_key)
    if isinstance(cached, bytes):
        return Response(
            content=cached,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400, immutable"},
        )

    inventory_path = Path(DATA) / "artifacts" / "real_inventory.parquet"
    if not inventory_path.exists():
        raise HTTPException(status_code=503, detail="Episode inventory is not ready.")
    inventory = pd.read_parquet(
        inventory_path,
        columns=["source", "episode_id", "zarr_prefix", "total_frames"],
    )
    match = inventory[
        inventory["source"].eq(source) & inventory["episode_id"].eq(episode_id)
    ]
    if len(match) != 1:
        raise HTTPException(status_code=404, detail="Episode not found.")

    row = match.iloc[0]
    try:
        group = _remote_group(str(row["zarr_prefix"]))
        images = group["images.front_1"]
        declared = int(row["total_frames"])
        usable = min(int(images.shape[0]), declared) if declared > 0 else int(images.shape[0])
        frame_index = max(0, usable // 2)
        item = images.oindex[[frame_index]][0]
        if isinstance(item, np.ndarray) and item.ndim == 3:
            image = Image.fromarray(np.asarray(item, dtype=np.uint8), mode="RGB")
        else:
            image = Image.open(io.BytesIO(bytes(item))).convert("RGB")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=86, optimize=True)
        blob = output.getvalue()
    except Exception as exc:
        print(
            f"preview extraction failed for {source}:{episode_id}: "
            f"{type(exc).__name__}: {exc}",
            flush=True,
        )
        raise HTTPException(status_code=502, detail="Episode frame is unavailable.") from exc

    preview_cache[cache_key] = blob
    return Response(
        content=blob,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )
