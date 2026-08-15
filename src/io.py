from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
import zarr
from PIL import Image

from src.paths import ROOT
from src.schemas import VALID_EMBODIMENTS, EpisodeValidationError, ManifestRow


def load_manifest(path: str | Path, subset: str) -> list[ManifestRow]:
    frame = pd.read_csv(path)
    required = ("episode_id", "zarr_path", "task", "lab", "scene", "fps")
    missing = [c for c in required if c not in frame.columns]
    if missing:
        raise EpisodeValidationError(f"{path} missing columns: {missing}")
    if frame[list(required)].isnull().any().any():
        raise EpisodeValidationError(f"{path} contains blank required values")
    duplicated = frame["episode_id"].astype(str).duplicated(keep=False)
    if duplicated.any():
        ids = sorted(frame.loc[duplicated, "episode_id"].astype(str).unique().tolist())
        raise EpisodeValidationError(f"{path} contains duplicate episode IDs: {ids}")
    rows: list[ManifestRow] = []
    for rec in frame.to_dict(orient="records"):
        fps = float(rec["fps"])
        if not np.isfinite(fps) or fps <= 0:
            raise EpisodeValidationError(
                f"{path} has invalid fps for {rec['episode_id']!r}: {rec['fps']!r}"
            )
        task = str(rec["task"]).strip()
        if not task:
            raise EpisodeValidationError(f"{path} contains an empty task")
        rows.append(
            ManifestRow(
                episode_id=str(rec["episode_id"]).strip(),
                zarr_path=str(rec["zarr_path"]).strip(),
                task=task,
                lab=str(rec["lab"]).strip(),
                scene=str(rec["scene"]).strip(),
                fps=fps,
                subset=subset,
            )
        )
    if not rows:
        raise EpisodeValidationError(f"{path} is empty")
    return rows


def resolve_zarr_path(zarr_path: str, root: Path | None = None) -> Path:
    path = Path(zarr_path)
    if path.is_absolute():
        return path
    base = root or ROOT
    return (base / path).resolve()


def open_episode(path: str | Path):
    path = Path(path)
    if not path.exists():
        raise EpisodeValidationError(f"episode store not found: {path}")
    marker = path / "zarr.json"
    if not marker.exists():
        raise EpisodeValidationError(f"missing zarr.json: {path}")
    return zarr.open_group(str(path), mode="r")


def _attrs(store) -> dict:
    return dict(store.attrs)


def validate_episode(store, *, expected_task: str | None = None) -> dict:
    attrs = _attrs(store)
    embodiment = str(attrs.get("embodiment", "")).strip()
    if embodiment not in VALID_EMBODIMENTS:
        raise EpisodeValidationError(
            f"invalid embodiment {embodiment!r}; expected one of {sorted(VALID_EMBODIMENTS)}"
        )
    intrinsics = attrs.get("intrinsics")
    if not _has_intrinsics(intrinsics):
        raise EpisodeValidationError("missing or invalid camera intrinsics")
    if "images.front_1" not in store:
        raise EpisodeValidationError("required array images.front_1 is absent")
    task = str(attrs.get("task_name", attrs.get("task", "")))
    if expected_task and task and task != expected_task:
        raise EpisodeValidationError(
            f"task mismatch: store={task!r} expected={expected_task!r}"
        )
    return attrs


def _has_intrinsics(intrinsics) -> bool:
    if not intrinsics:
        return False
    if isinstance(intrinsics, str):
        try:
            intrinsics = json.loads(intrinsics)
        except json.JSONDecodeError:
            return False
    if isinstance(intrinsics, dict):
        if not intrinsics:
            return False
        sample = next(iter(intrinsics.values()))
        arr = np.asarray(sample, dtype=np.float64)
        return arr.size >= 9
    arr = np.asarray(intrinsics, dtype=np.float64)
    return arr.size >= 9


def sampled_indices(n_frames: int, n_samples: int) -> np.ndarray:
    if n_frames <= 0:
        raise EpisodeValidationError("episode has zero frames")
    if n_frames <= n_samples:
        return np.arange(n_frames, dtype=np.int64)
    return np.linspace(0, n_frames - 1, n_samples, dtype=np.int64)


def read_array(store, key: str) -> np.ndarray | None:
    if key not in store:
        return None
    return np.asarray(store[key][:])


def decode_frames(raw, indices: np.ndarray) -> np.ndarray:
    subset = raw[indices]
    if subset.ndim == 4:
        return np.asarray(subset)
    frames = []
    for item in subset:
        if isinstance(item, np.ndarray) and item.ndim == 3:
            frames.append(item)
            continue
        blob = bytes(item)
        img = Image.open(io.BytesIO(blob)).convert("RGB")
        frames.append(np.asarray(img))
    return np.stack(frames, axis=0)


def save_preview(rgb: np.ndarray, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.asarray(rgb, dtype=np.uint8)).save(dest, format="JPEG", quality=85)
    return dest
