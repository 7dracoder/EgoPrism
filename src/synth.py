from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import zarr
from PIL import Image, ImageDraw, ImageFilter

from src.paths import EPISODE_DIR, MANIFEST_DIR
from src.schemas import DINO_DIM, RNG_SEED

TASK = "fold-clothes"
FPS = 30
N_FRAMES = 90
IMG_H, IMG_W = 72, 96
N_PER_SUBSET = 16
DEMO_VERSION = "2026-08-15-v2"
DEMO_MARKER = ".egoprism-demo-version"

FRONT_K = [
    [266.508, 0.0, 320.0, 0.0],
    [0.0, 266.508, 240.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
]

SCENE_PALETTES = {
    "scene_01": ((210, 186, 150), (92, 64, 51)),
    "scene_02": ((176, 196, 188), (46, 80, 84)),
    "scene_03": ((198, 176, 196), (78, 48, 96)),
    "scene_04": ((186, 198, 168), (54, 90, 48)),
    "scene_05": ((220, 200, 170), (120, 72, 40)),
    "scene_06": ((168, 184, 210), (40, 56, 110)),
    "scene_07": ((210, 176, 164), (110, 48, 48)),
    "scene_08": ((186, 210, 206), (36, 96, 88)),
}


def write_demo_subsets(
    *,
    episode_dir: Path | None = None,
    manifest_dir: Path | None = None,
    n_per_subset: int = N_PER_SUBSET,
    seed: int = RNG_SEED,
) -> tuple[Path, Path]:
    episode_dir = episode_dir or EPISODE_DIR
    manifest_dir = manifest_dir or MANIFEST_DIR
    episode_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)

    scene_centroids = _scene_centroids(rng)
    rows_a = _write_subset(
        "A",
        episode_dir,
        rng,
        scene_centroids,
        n=n_per_subset,
        narrow=True,
    )
    rows_b = _write_subset(
        "B",
        episode_dir,
        rng,
        scene_centroids,
        n=n_per_subset,
        narrow=False,
    )
    path_a = manifest_dir / "subset_a.csv"
    path_b = manifest_dir / "subset_b.csv"
    pd.DataFrame(rows_a).to_csv(path_a, index=False)
    pd.DataFrame(rows_b).to_csv(path_b, index=False)
    (episode_dir / DEMO_MARKER).write_text(DEMO_VERSION + "\n", encoding="utf-8")
    return path_a, path_b


def demo_fixture_needs_refresh(
    *,
    episode_dir: Path,
    manifest_dir: Path,
    n_per_subset: int = N_PER_SUBSET,
) -> bool:
    """Refresh only EgoPrism-owned demo data, never an unknown real dataset."""
    marker = episode_dir / DEMO_MARKER
    if marker.exists():
        return marker.read_text(encoding="utf-8").strip() != DEMO_VERSION

    episode_ids = {path.stem for path in episode_dir.glob("*.zarr")}
    if not episode_ids:
        return True

    expected_ids = {
        *(f"fold_a_{i:03d}" for i in range(1, n_per_subset + 1)),
        *(f"fold_b_{i:03d}" for i in range(1, n_per_subset + 1)),
    }
    has_demo_manifests = all(
        (manifest_dir / name).exists() for name in ("subset_a.csv", "subset_b.csv")
    )
    return has_demo_manifests and episode_ids.issubset(expected_ids)


def _write_subset(
    subset: str,
    episode_dir: Path,
    rng: np.random.Generator,
    scene_centroids: dict[str, np.ndarray],
    *,
    n: int,
    narrow: bool,
) -> list[dict]:
    rows = []
    scenes = ["scene_01"] if narrow else [f"scene_{i:02d}" for i in range(1, 9)]
    labs = ["lab_a"] if narrow else ["lab_a", "lab_b", "lab_c", "lab_d"]
    prefix = "fold_a" if subset == "A" else "fold_b"
    for i in range(n):
        episode_id = f"{prefix}_{i + 1:03d}"
        scene = scenes[i % len(scenes)]
        lab = labs[i % len(labs)]
        rel = Path("data") / "episodes" / f"{episode_id}.zarr"
        dest = episode_dir / f"{episode_id}.zarr"
        _write_episode(
            dest,
            rng,
            scene=scene,
            lab=lab,
            centroid=scene_centroids[scene],
            narrow=narrow,
            episode_index=i,
            include_motion=True,
        )
        rows.append(
            {
                "episode_id": episode_id,
                "zarr_path": str(rel).replace("\\", "/"),
                "task": TASK,
                "lab": lab,
                "scene": scene,
                "fps": FPS,
            }
        )
    return rows


def _scene_centroids(rng: np.random.Generator) -> dict[str, np.ndarray]:
    out = {}
    basis = rng.normal(size=(8, DINO_DIM))
    basis = basis / (np.linalg.norm(basis, axis=1, keepdims=True) + 1e-8)
    for i in range(8):
        out[f"scene_{i + 1:02d}"] = basis[i] * 4.0
    return out


def _write_episode(
    dest: Path,
    rng: np.random.Generator,
    *,
    scene: str,
    lab: str,
    centroid: np.ndarray,
    narrow: bool,
    episode_index: int,
    include_motion: bool = True,
) -> None:
    if dest.exists():
        import shutil

        shutil.rmtree(dest)
    t = np.arange(N_FRAMES, dtype=np.float64) / FPS
    dino = _dino_track(centroid, rng, narrow=narrow)
    images = _render_episode(scene, t, rng, narrow=narrow, episode_index=episode_index)
    head, left, right = _poses(t, rng, narrow=narrow, episode_index=episode_index)

    store = zarr.open_group(str(dest), mode="w", zarr_format=3)
    _put(store, "images.front_1", images, chunks=(10, IMG_H, IMG_W, 3))
    _put(store, "dino.front_img_1", dino.astype(np.float32), chunks=(N_FRAMES, DINO_DIM))
    features = {
        "images.front_1": {"dtype": "uint8", "shape": [IMG_H, IMG_W, 3]},
        "dino.front_img_1": {"dtype": "float32", "shape": [DINO_DIM]},
    }
    if include_motion:
        _put(store, "obs_head_pose", head.astype(np.float32), chunks=(N_FRAMES, 7))
        _put(store, "left.obs_ee_pose", left.astype(np.float32), chunks=(N_FRAMES, 7))
        _put(store, "right.obs_ee_pose", right.astype(np.float32), chunks=(N_FRAMES, 7))
        features.update(
            {
                "obs_head_pose": {"dtype": "float32", "shape": [7]},
                "left.obs_ee_pose": {"dtype": "float32", "shape": [7]},
                "right.obs_ee_pose": {"dtype": "float32", "shape": [7]},
            }
        )
    store.attrs.update(
        {
            "embodiment": "human_bimanual",
            "total_frames": N_FRAMES,
            "fps": FPS,
            "task_name": TASK,
            "task_description": "three-fold a t-shirt from a random initial pose",
            "lab": lab,
            "scene": scene,
            "intrinsics": {"front_1": FRONT_K},
            "features": features,
        }
    )


def _put(store, name: str, data: np.ndarray, chunks) -> None:
    arr = store.create_array(name, shape=data.shape, dtype=data.dtype, chunks=chunks)
    arr[:] = data


def _dino_track(centroid: np.ndarray, rng: np.random.Generator, *, narrow: bool) -> np.ndarray:
    noise_scale = 0.04 if narrow else 0.18
    episode_shift = rng.normal(0.0, 0.03 if narrow else 0.25, size=DINO_DIM)
    frames = np.stack(
        [
            centroid + episode_shift + rng.normal(0.0, noise_scale, size=DINO_DIM)
            for _ in range(N_FRAMES)
        ]
    )
    return frames.astype(np.float32)


def _poses(t: np.ndarray, rng: np.random.Generator, *, narrow: bool, episode_index: int):
    identity = np.array([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0])
    head = np.tile(identity, (len(t), 1))
    amp_h = 0.01 if narrow else 0.02 + 0.04 * ((episode_index % 5) / 4)
    head[:, 0] = amp_h * np.sin(0.7 * t)
    head[:, 1] = amp_h * np.cos(0.5 * t)
    head[:, 2] = 1.45
    dqw = 0.0 if narrow else 0.04 * np.sin(0.4 * t * (1 + episode_index % 3))
    head[:, 3] = np.sqrt(np.clip(1.0 - dqw**2, 0, 1))
    head[:, 6] = dqw

    radius = (
        0.03 + 0.04 * ((episode_index % 4) / 3)
        if narrow
        else 0.08 + 0.28 * ((episode_index % 8) / 7)
    )
    left = np.tile(identity, (len(t), 1))
    right = np.tile(identity, (len(t), 1))
    phase = 0.2 if narrow else 0.6 * episode_index
    freq = (
        0.55 + 0.35 * ((episode_index % 4) / 3)
        if narrow
        else 0.5 + 1.6 * ((episode_index % 6) / 5)
    )
    stationary_lead = 1.1 + 0.8 * ((episode_index % 4) / 3)
    for i, ti in enumerate(t):
        # The narrow slice intentionally contains a long stationary lead-in.
        # This creates real near-zero velocity frames instead of merely scaling
        # an always-moving sinusoid down.
        motion_t = max(0.0, ti - stationary_lead) if narrow else ti
        left[i, 0] = 0.15 + radius * np.sin(freq * motion_t + phase)
        left[i, 1] = -0.20 + radius * np.cos(freq * 0.7 * motion_t)
        left[i, 2] = 0.90 + 0.3 * radius * np.sin(freq * 1.3 * motion_t)
        right[i, 0] = -0.15 + radius * np.sin(freq * motion_t + phase + 0.4)
        right[i, 1] = -0.22 + radius * np.cos(freq * 0.9 * motion_t + 0.3)
        right[i, 2] = 0.88 + 0.3 * radius * np.cos(freq * 1.1 * motion_t)
    jitter = 0.00008 if narrow else 0.012
    left[:, :3] += rng.normal(0, jitter, size=(len(t), 3))
    right[:, :3] += rng.normal(0, jitter, size=(len(t), 3))
    return head.astype(np.float32), left.astype(np.float32), right.astype(np.float32)


def _render_episode(
    scene: str,
    t: np.ndarray,
    rng: np.random.Generator,
    *,
    narrow: bool,
    episode_index: int,
) -> np.ndarray:
    bg, accent = SCENE_PALETTES[scene]
    frames = np.zeros((len(t), IMG_H, IMG_W, 3), dtype=np.uint8)
    for i, ti in enumerate(t):
        img = Image.new("RGB", (IMG_W, IMG_H), bg)
        draw = ImageDraw.Draw(img)
        table = (8, 34, IMG_W - 8, IMG_H - 6)
        draw.rectangle(table, fill=tuple(max(0, c - 28) for c in bg))
        cloth = accent if not narrow else tuple((np.array(accent) * 0.85 + 20).astype(int))
        cx = 28 + int(18 * np.sin(0.9 * ti + 0.2 * episode_index))
        cy = 40 + int(8 * np.cos(0.7 * ti))
        draw.ellipse((cx, cy, cx + 38, cy + 22), fill=tuple(int(c) for c in cloth))
        hx = 20 + int((8 if narrow else 22) * (0.5 + 0.5 * np.sin(1.6 * ti)))
        hy = 28 + int(10 * np.sin(1.1 * ti + 1.0))
        draw.ellipse((hx, hy, hx + 14, hy + 10), fill=(226, 188, 154))
        draw.ellipse((hx + 36, hy + 2, hx + 50, hy + 12), fill=(226, 188, 154))
        img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
        arr = np.asarray(img).astype(np.int16)
        arr += rng.integers(-6, 7, size=arr.shape)
        frames[i] = np.clip(arr, 0, 255).astype(np.uint8)
    return frames


def write_invalid_episode(dest: Path, kind: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        import shutil

        shutil.rmtree(dest)
    store = zarr.open_group(str(dest), mode="w", zarr_format=3)
    dummy = np.zeros((8, IMG_H, IMG_W, 3), dtype=np.uint8)
    if kind != "missing_images":
        _put(store, "images.front_1", dummy, chunks=(8, IMG_H, IMG_W, 3))
    attrs = {
        "embodiment": "human_bimanual",
        "total_frames": 8,
        "fps": 30,
        "task_name": TASK,
        "intrinsics": {"front_1": FRONT_K},
    }
    if kind == "bad_embodiment":
        attrs["embodiment"] = "aria_bimanual"
    if kind == "missing_intrinsics":
        attrs.pop("intrinsics")
    store.attrs.update(attrs)
    return dest
