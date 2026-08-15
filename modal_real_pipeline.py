"""Build a real EgoVerse inventory and feature cache on Modal.

This module reads production Zarr metadata directly from the private EgoVerse
R2 bucket. Credentials are supplied only through the ``egoverse-r2`` Modal
secret; no raw data or credentials are committed to this repository.

Inventory the available production episodes with:

    modal run modal_real_pipeline.py::inventory_main

The inventory is persisted at ``/data/artifacts/real_inventory.parquet`` in
the ``egoverse-data`` Modal volume and is used to select a genuinely
task-matched 10,000+ episode comparison.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import io
import json
import os
from pathlib import Path
from typing import Any

import modal


PACKAGES = [
    "boto3==1.40.0",
    "s3fs==2025.7.0",
    "zarr==3.1.2",
    "numcodecs==0.16.2",
    "pillow==11.2.1",
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
app = modal.App("egoprism-real-pipeline", image=image)
data_vol = modal.Volume.from_name("egoverse-data", create_if_missing=True)
r2_secret = modal.Secret.from_name("egoverse-r2")

DATA = Path("/data")
BUCKET = "rldb"
PRODUCTION_PREFIX = "processed_v3"
DEFAULT_SOURCES = ("aria", "eva", "scale")
COMPARISON_TASK = "household_manipulation"
PREVIEW_ENDPOINT = "https://ts5789--egoprism-api-preview.modal.run"


def _s3_client():
    import boto3
    from botocore.config import Config

    endpoint = (
        os.environ.get("R2_ENDPOINT_URL")
        or os.environ.get("AWS_ENDPOINT_URL_S3")
        or os.environ.get("S3_ENDPOINT_URL")
    )


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
            "config_kwargs": {
                "signature_version": "s3v4",
                "retries": {"max_attempts": 8, "mode": "adaptive"},
            },
            "default_fill_cache": False,
        },
        read_only=True,
    )
    return zarr.open_group(store=store, mode="r")


def _sample_indices(n_frames: int, count: int = 8):
    import numpy as np

    if n_frames <= 0:
        raise ValueError("episode contains no image frames")
    if n_frames <= count:
        return np.arange(n_frames, dtype=np.int64)
    return np.linspace(0, n_frames - 1, count, dtype=np.int64)


def _decode_sampled_frames(group: Any, indices: Any) -> list[Any]:
    import numpy as np
    from PIL import Image

    images = group["images.front_1"]
    frames = []
    for item in images.oindex[indices]:
        if isinstance(item, np.ndarray) and item.ndim == 3:
            image = Image.fromarray(np.asarray(item, dtype=np.uint8), mode="RGB")
        else:
            image = Image.open(io.BytesIO(bytes(item))).convert("RGB")
        frames.append(np.asarray(image.resize((64, 48)), dtype=np.uint8))
    return frames


def _color_grid_embedding(frames: list[Any]) -> list[float]:
    import numpy as np

    x = np.asarray(frames, dtype=np.float64) / 255.0
    mean = x.reshape(len(x), -1, 3).mean(axis=1)
    std = x.reshape(len(x), -1, 3).std(axis=1)
    grid = []
    for frame in x:
        h, w, _ = frame.shape
        ys = np.linspace(0, h, 5, dtype=int)
        xs = np.linspace(0, w, 5, dtype=int)
        cells = [
            frame[ys[i] : ys[i + 1], xs[j] : xs[j + 1]].mean(axis=(0, 1))
            for i in range(4)
            for j in range(4)
        ]
        grid.append(np.concatenate(cells))
    vector = np.concatenate([mean.mean(0), std.mean(0), np.mean(grid, axis=0)])
    vector /= np.linalg.norm(vector) + 1e-8
    return vector.astype(np.float64).tolist()


def _read_pose(group: Any, key: str):
    import numpy as np

    if key not in group:
        return None
    value = np.asarray(group[key][:], dtype=np.float64)
    if value.ndim != 2 or value.shape[0] == 0 or value.shape[1] < 3:
        return None
    return value


def _quat_to_mats(quaternions: Any):
    import numpy as np

    q = np.asarray(quaternions, dtype=np.float64)
    norm = np.linalg.norm(q, axis=1, keepdims=True)
    q = q / np.maximum(norm, 1e-12)
    w, x, y, z = q.T
    result = np.empty((len(q), 3, 3), dtype=np.float64)
    result[:, 0, 0] = 1 - 2 * (y * y + z * z)
    result[:, 0, 1] = 2 * (x * y - z * w)
    result[:, 0, 2] = 2 * (x * z + y * w)
    result[:, 1, 0] = 2 * (x * y + z * w)
    result[:, 1, 1] = 1 - 2 * (x * x + z * z)
    result[:, 1, 2] = 2 * (y * z - x * w)
    result[:, 2, 0] = 2 * (x * z - y * w)
    result[:, 2, 1] = 2 * (y * z + x * w)
    result[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return result


def _ee_xyz(head: Any, ee: Any):
    import numpy as np

    xyz = np.asarray(ee[:, :3], dtype=np.float64)
    if (
        head is None
        or len(head) != len(ee)
        or head.shape[1] < 7
        or ee.shape[1] < 3
    ):
        return xyz
    rotations = _quat_to_mats(head[:, 3:7])
    delta = xyz - np.asarray(head[:, :3], dtype=np.float64)
    return np.einsum("tji,tj->ti", rotations, delta)


def _finite_xyz(value: Any):
    import numpy as np

    if value is None:
        return None
    value = np.asarray(value, dtype=np.float64)
    value = value[np.isfinite(value).all(axis=1)]
    return value if len(value) else None


def _path_length(xyz: Any) -> float | None:
    import numpy as np

    xyz = _finite_xyz(xyz)
    if xyz is None or len(xyz) < 2:
        return None
    return float(np.linalg.norm(np.diff(xyz, axis=0), axis=1).sum())


def _speeds(xyz: Any, fps: float):
    import numpy as np

    xyz = _finite_xyz(xyz)
    if xyz is None or len(xyz) < 2:
        return np.zeros(0, dtype=np.float64)
    return np.linalg.norm(np.diff(xyz, axis=0), axis=1) * fps


def _rotation_path(head: Any) -> float | None:
    import numpy as np

    if head is None or head.shape[1] < 7 or len(head) < 2:
        return None
    q = np.asarray(head[:, 3:7], dtype=np.float64)
    q = q[np.isfinite(q).all(axis=1)]
    if len(q) < 2:
        return None
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    dots = np.clip(np.abs(np.sum(q[:-1] * q[1:], axis=1)), 0.0, 1.0)
    return float(np.sum(2.0 * np.arccos(dots)))


def _motion_features(group: Any, fps: float) -> dict[str, Any]:
    import numpy as np

    head = _read_pose(group, "obs_head_pose")
    left = _read_pose(group, "left.obs_ee_pose")
    right = _read_pose(group, "right.obs_ee_pose")
    left_xyz = _ee_xyz(head, left) if left is not None else None
    right_xyz = _ee_xyz(head, right) if right is not None else None
    left_speed = _speeds(left_xyz, fps)
    right_speed = _speeds(right_xyz, fps)
    speed_parts = [part for part in (left_speed, right_speed) if len(part)]
    speed = np.concatenate(speed_parts) if speed_parts else np.zeros(0)
    correlation = None
    n = min(len(left_speed), len(right_speed))
    if n >= 8 and left_speed[:n].std() > 1e-8 and right_speed[:n].std() > 1e-8:
        correlation = float(np.corrcoef(left_speed[:n], right_speed[:n])[0, 1])
    return {
        "left_traj_m": _path_length(left_xyz),
        "right_traj_m": _path_length(right_xyz),
        "ee_speed_median": float(np.median(speed)) if len(speed) else None,
        "ee_speed_p90": float(np.quantile(speed, 0.9)) if len(speed) else None,
        "idle_frac": float(np.mean(speed < 0.02)) if len(speed) else None,
        "head_translation_m": _path_length(head[:, :3]) if head is not None else None,
        "head_rotation_rad": _rotation_path(head),
        "bimanual_speed_corr": correlation,
        "has_left": left is not None,
        "has_right": right is not None,
        "has_head": head is not None,
        "has_motion": left is not None or right is not None or head is not None,
    }
    if not endpoint:
        raise RuntimeError("The egoverse-r2 secret is missing its endpoint URL.")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_DEFAULT_REGION", "auto"),
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 8, "mode": "adaptive"},
            max_pool_connections=128,
        ),
    )


def _episode_prefixes(client: Any, source: str) -> list[str]:
    prefix = f"{PRODUCTION_PREFIX}/{source}/"
    paginator = client.get_paginator("list_objects_v2")
    pages = paginator.paginate(
        Bucket=BUCKET,
        Prefix=prefix,
        Delimiter="/",
        PaginationConfig={"PageSize": 1000},
    )
    return [
        item["Prefix"]
        for page in pages
        for item in page.get("CommonPrefixes", [])
        if item.get("Prefix", "").rstrip("/").endswith(".zarr")
    ]


def _read_episode_metadata(client: Any, source: str, prefix: str) -> dict[str, Any] | None:
    key = f"{prefix.rstrip('/')}/zarr.json"
    try:
        response = client.get_object(Bucket=BUCKET, Key=key)
        payload = json.loads(response["Body"].read())
    except Exception as exc:
        return {
            "source": source,
            "episode_id": Path(prefix.rstrip("/")).stem,
            "zarr_prefix": f"s3://{BUCKET}/{prefix.rstrip('/')}",
            "inventory_error": f"{type(exc).__name__}: {exc}"[:300],
        }

    attrs = payload.get("attributes") or payload
    if not isinstance(attrs, dict):
        attrs = {}
    episode_id = Path(prefix.rstrip("/")).stem
    return {
        "source": source,
        "episode_id": episode_id,
        "zarr_prefix": f"s3://{BUCKET}/{prefix.rstrip('/')}",
        "task": str(attrs.get("task_name") or attrs.get("task") or "unknown"),
        "task_description": str(attrs.get("task_description") or ""),
        "embodiment": str(attrs.get("embodiment") or "unknown"),
        "lab": str(attrs.get("lab") or source),
        "scene": str(attrs.get("scene") or "unknown"),
        "fps": float(attrs.get("fps") or 30.0),
        "total_frames": int(attrs.get("total_frames") or -1),
        "is_deleted": bool(attrs.get("is_deleted", False)),
        "inventory_error": "",
    }


@app.function(
    secrets=[r2_secret],
    volumes={str(DATA): data_vol},
    timeout=60 * 30,
    cpu=4.0,
    memory=4096,
)
def build_inventory(sources: list[str] | None = None) -> dict[str, Any]:
    import pandas as pd

    sources = sources or list(DEFAULT_SOURCES)
    client = _s3_client()
    work: list[tuple[str, str]] = []
    prefix_counts: dict[str, int] = {}
    for source in sources:
        prefixes = _episode_prefixes(client, source)
        prefix_counts[source] = len(prefixes)
        work.extend((source, prefix) for prefix in prefixes)

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=96) as pool:
        futures = [
            pool.submit(_read_episode_metadata, client, source, prefix)
            for source, prefix in work
        ]
        for future in as_completed(futures):
            row = future.result()
            if row is not None:
                rows.append(row)

    frame = pd.DataFrame(rows)
    out = DATA / "artifacts" / "real_inventory.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(out, index=False)
    data_vol.commit()

    valid = frame[
        frame["inventory_error"].eq("") & ~frame["is_deleted"].fillna(False)
    ]
    task_counts = (
        valid.groupby("task", dropna=False)
        .size()
        .sort_values(ascending=False)
        .head(30)
        .astype(int)
        .to_dict()
    )
    source_task_counts = (
        valid.groupby(["source", "task"], dropna=False)
        .size()
        .sort_values(ascending=False)
        .head(50)
    )
    return {
        "prefix_counts": prefix_counts,
        "metadata_rows": int(len(frame)),
        "valid_rows": int(len(valid)),
        "error_rows": int(frame["inventory_error"].ne("").sum()),
        "task_counts": task_counts,
        "source_task_counts": {
            f"{source}:{task}": int(count)
            for (source, task), count in source_task_counts.items()
        },
        "inventory_path": str(out),
    }


@app.function(volumes={str(DATA): data_vol}, timeout=180, cpu=2.0, memory=4096)
def load_inventory_rows(limit: int = 0) -> list[dict[str, Any]]:
    import numpy as np
    import pandas as pd

    data_vol.reload()
    path = DATA / "artifacts" / "real_inventory.parquet"
    if not path.exists():
        raise RuntimeError("Real inventory is missing. Run inventory_main first.")
    frame = pd.read_parquet(path)
    frame = frame[
        frame["inventory_error"].eq("") & ~frame["is_deleted"].fillna(False)
    ].copy()
    frame["stable_key"] = frame.apply(
        lambda row: hashlib.sha256(
            f"{row['source']}:{row['task']}:{row['episode_id']}".encode()
        ).hexdigest(),
        axis=1,
    )
    frame = frame.sort_values(["source", "task", "stable_key"]).reset_index(drop=True)
    within_stratum = frame.groupby(["source", "task"], sort=False).cumcount()
    frame["subset"] = np.where(within_stratum % 2 == 0, "A", "B")
    if limit > 0 and limit < len(frame):
        positions = np.linspace(0, len(frame) - 1, limit, dtype=np.int64)
        frame = frame.iloc[positions].copy()

    rows = []
    for row in frame.itertuples(index=False):
        rows.append(
            {
                "source": str(row.source),
                "raw_episode_id": str(row.episode_id),
                "zarr_prefix": str(row.zarr_prefix),
                "episode_task": str(row.task),
                "lab": str(row.lab),
                "scene": str(row.scene),
                "fps": float(row.fps),
                "total_frames": int(row.total_frames),
                "subset": str(row.subset),
            }
        )
    return rows


@app.function(
    secrets=[r2_secret],
    timeout=600,
    cpu=1.0,
    memory=2048,
    retries=2,
    max_containers=240,
)
def extract_real_episode(row: dict[str, Any]) -> dict[str, Any]:
    import numpy as np

    source = str(row["source"])
    raw_episode_id = str(row["raw_episode_id"])
    episode_id = f"{source}--{raw_episode_id}"
    try:
        group = _remote_group(str(row["zarr_prefix"]))
        if "images.front_1" not in group:
            raise ValueError("images.front_1 is missing")
        available_frames = int(group["images.front_1"].shape[0])
        declared_frames = int(row.get("total_frames") or -1)
        n_frames = (
            min(available_frames, declared_frames)
            if declared_frames > 0
            else available_frames
        )
        indices = _sample_indices(n_frames)
        frames = _decode_sampled_frames(group, indices)
        embedding = _color_grid_embedding(frames)
        fps = float(row.get("fps") or group.attrs.get("fps") or 30.0)
        motion = _motion_features(group, fps)
        if not np.isfinite(np.asarray(embedding, dtype=np.float64)).all():
            raise ValueError("visual embedding contains non-finite values")
        return {
            "ok": True,
            "episode_id": episode_id,
            "raw_episode_id": raw_episode_id,
            "source": source,
            "subset": str(row["subset"]),
            "task": COMPARISON_TASK,
            "episode_task": str(row["episode_task"]),
            "lab": str(row.get("lab") or source),
            "scene": str(row.get("scene") or "unknown"),
            "fps": fps,
            "n_frames": n_frames,
            "duration_s": n_frames / max(fps, 1e-6),
            "visual_embedding": embedding,
            "has_visual": True,
            "visual_source": "rgb_color_grid_8frame",
            "sampled_frame_indices": indices.tolist(),
            "preview_path": (
                f"{PREVIEW_ENDPOINT}?source={source}&episode_id={raw_episode_id}"
            ),
            **motion,
        }
    except Exception as exc:
        return {
            "ok": False,
            "episode_id": episode_id,
            "source": source,
            "raw_episode_id": raw_episode_id,
            "error": f"{type(exc).__name__}: {exc}"[:500],
        }


@app.function(volumes={str(DATA): data_vol}, timeout=300, cpu=1.0, memory=2048)
def publish_feature_cache(blob: bytes) -> dict[str, Any]:
    import pandas as pd

    out = DATA / "artifacts" / "features-real.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    data_vol.commit()
    frame = pd.read_parquet(out)
    return {
        "path": str(out),
        "episodes": int(len(frame)),
        "subset_counts": {
            str(key): int(value) for key, value in frame.groupby("subset").size().items()
        },
        "sources": {
            str(key): int(value) for key, value in frame.groupby("source").size().items()
        },
    }


@app.function(secrets=[r2_secret], timeout=300, cpu=2.0, memory=4096)
def probe_remote_episode(uri: str) -> dict[str, Any]:
    """Read a few remote samples to validate range reads and codecs."""
    import io

    import numpy as np
    from PIL import Image

    group = _remote_group(uri)
    images = group["images.front_1"]
    indices = np.linspace(0, images.shape[0] - 1, 3, dtype=np.int64)
    decoded = []
    for item in images.oindex[indices]:
        image = Image.open(io.BytesIO(bytes(item))).convert("RGB")
        decoded.append([image.width, image.height])
    arrays = {}
    for key in ("obs_head_pose", "left.obs_ee_pose", "right.obs_ee_pose"):
        if key in group:
            arrays[key] = list(group[key].shape)
    return {
        "uri": uri,
        "task": str(group.attrs.get("task_name") or "unknown"),
        "image_shape": list(images.shape),
        "sample_indices": indices.tolist(),
        "decoded_sizes": decoded,
        "motion_arrays": arrays,
    }


@app.local_entrypoint()
def inventory_main():
    result = build_inventory.remote()
    print(json.dumps(result, indent=2, sort_keys=True))


@app.local_entrypoint()
def probe_main():
    uris = [
        "s3://rldb/processed_v3/aria/2025-09-20-17-42-51-000000.zarr",
        "s3://rldb/processed_v3/eva/2025-11-26-21-07-35-274000.zarr",
        "s3://rldb/processed_v3/scale/2026-04-30-09-00-59-534045.zarr",
    ]
    for result in probe_remote_episode.map(uris):
        print(json.dumps(result, indent=2, sort_keys=True))


@app.local_entrypoint()
def extract_main(limit: int = 0, publish: bool = False):
    import pandas as pd

    rows = load_inventory_rows.remote(limit)
    print(f"queued {len(rows):,} real production episodes")
    good: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for index, result in enumerate(
        extract_real_episode.map(rows, order_outputs=False), start=1
    ):
        if result.pop("ok", False):
            good.append(result)
        else:
            errors.append(result)
        if index % 500 == 0 or index == len(rows):
            print(
                f"processed {index:,}/{len(rows):,} "
                f"({len(good):,} valid, {len(errors):,} skipped)"
            )

    artifact_dir = Path("artifacts")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    output = artifact_dir / "features-real.parquet"
    error_output = artifact_dir / "features-real-errors.json"
    frame = pd.DataFrame(good)
    frame.to_parquet(output, index=False)
    error_output.write_text(json.dumps(errors, indent=2, sort_keys=True))

    if limit == 0 and len(frame) < 10_000:
        raise RuntimeError(
            f"Only {len(frame):,} real episodes passed extraction; refusing to publish."
        )
    if frame.empty:
        raise RuntimeError("No real episodes passed extraction.")

    from src.web_payload import comparison_payload

    payload = comparison_payload(frame, source="modal-real")
    summary_output = artifact_dir / "real-summary.json"
    summary_output.write_text(json.dumps(payload, separators=(",", ":")))
    print(
        f"scored {len(frame):,} episodes: "
        f"A={payload['subsetA']['score']:.2f}, B={payload['subsetB']['score']:.2f}, "
        f"winner={payload['winner']}"
    )
    print(f"wrote {output} and {summary_output}")
    if publish:
        published = publish_feature_cache.remote(output.read_bytes())
        print(json.dumps({"published": published}, indent=2, sort_keys=True))
