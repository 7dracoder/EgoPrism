from __future__ import annotations

from pathlib import Path

import numpy as np

from src.io import (
    decode_frames,
    open_episode,
    read_array,
    sampled_indices,
    save_preview,
    validate_episode,
)
from src.paths import PREVIEW_DIR, ROOT
from src.schemas import (
    IDLE_SPEED_THRESHOLD_MPS,
    N_SAMPLE_FRAMES,
    EpisodeFeatures,
    ManifestRow,
    MotionSignals,
)


def extract_episode(
    row: ManifestRow,
    *,
    preview_dir: Path | None = None,
    project_root: Path | None = None,
    n_sample_frames: int = N_SAMPLE_FRAMES,
) -> EpisodeFeatures:
    root = project_root or ROOT
    store_path = Path(row.zarr_path)
    if not store_path.is_absolute():
        store_path = (root / store_path).resolve()
    store = open_episode(store_path)
    attrs = validate_episode(store, expected_task=row.task)
    n_frames = int(attrs.get("total_frames", store["images.front_1"].shape[0]))
    fps = float(attrs.get("fps", row.fps))
    idx = sampled_indices(n_frames, n_sample_frames)

    visual, visual_source = _visual_embedding(store, idx)
    images = decode_frames(store["images.front_1"], idx)
    mid = images[len(images) // 2]
    dest = (preview_dir or PREVIEW_DIR) / f"{row.episode_id}.jpg"
    save_preview(mid, dest)

    motion = _motion_features(store, fps)
    return EpisodeFeatures(
        episode_id=row.episode_id,
        subset=row.subset,
        task=row.task,
        lab=row.lab,
        scene=row.scene,
        fps=fps,
        n_frames=n_frames,
        duration_s=n_frames / max(fps, 1e-6),
        visual_embedding=visual.tolist(),
        has_visual=True,
        preview_path=f"artifacts/previews/{row.episode_id}.jpg",
        motion=motion,
        sampled_frame_indices=idx.tolist(),
        visual_source=visual_source,
    )


def _visual_embedding(store, idx: np.ndarray) -> tuple[np.ndarray, str]:
    dino = read_array(store, "dino.front_img_1")
    if (
        dino is not None
        and dino.ndim == 2
        and dino.shape[0] > int(idx.max(initial=0))
        and dino.shape[1] > 0
        and np.isfinite(dino[idx]).all()
    ):
        frames = dino[idx]
        frames = _l2_normalize(frames)
        pooled = _l2_normalize(frames.mean(axis=0, keepdims=True))[0]
        return pooled.astype(np.float64), "dino.front_img_1"
    images = decode_frames(store["images.front_1"], idx)
    pooled = _fallback_image_embedding(images)
    return pooled, "color_grid_fallback"


def _fallback_image_embedding(images: np.ndarray) -> np.ndarray:
    """Cheap CPU embedding when stored DINO is absent. Not a replacement for DINOv3."""
    x = images.astype(np.float64) / 255.0
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
    feat = np.concatenate([mean.mean(0), std.mean(0), np.mean(grid, axis=0)])
    return _l2_normalize(feat.reshape(1, -1))[0]


def _motion_features(store, fps: float) -> MotionSignals:
    head = read_array(store, "obs_head_pose")
    left = read_array(store, "left.obs_ee_pose")
    right = read_array(store, "right.obs_ee_pose")
    left_xyz = _ee_in_head_frame(head, left) if left is not None else None
    right_xyz = _ee_in_head_frame(head, right) if right is not None else None

    left_traj = _path_length(left_xyz) if left_xyz is not None else None
    right_traj = _path_length(right_xyz) if right_xyz is not None else None
    speeds = []
    if left_xyz is not None:
        speeds.append(_speeds(left_xyz, fps))
    if right_xyz is not None:
        speeds.append(_speeds(right_xyz, fps))
    speed_cat = np.concatenate(speeds) if speeds else None
    idle = None
    med = p90 = None
    if speed_cat is not None and speed_cat.size:
        med = float(np.median(speed_cat))
        p90 = float(np.quantile(speed_cat, 0.9))
        idle = float(np.mean(speed_cat < IDLE_SPEED_THRESHOLD_MPS))

    head_t = head_r = None
    if head is not None and len(head) >= 2:
        head_t = _path_length(np.asarray(head[:, :3], dtype=np.float64))
        head_r = _rotation_path(np.asarray(head[:, 3:7], dtype=np.float64))

    corr = None
    if left_xyz is not None and right_xyz is not None:
        ls = _speeds(left_xyz, fps)
        rs = _speeds(right_xyz, fps)
        n = min(len(ls), len(rs))
        if n >= 8 and ls[:n].std() > 1e-8 and rs[:n].std() > 1e-8:
            corr = float(np.corrcoef(ls[:n], rs[:n])[0, 1])

    return MotionSignals(
        left_traj_m=left_traj,
        right_traj_m=right_traj,
        ee_speed_median=med,
        ee_speed_p90=p90,
        idle_frac=idle,
        head_translation_m=head_t,
        head_rotation_rad=head_r,
        bimanual_speed_corr=corr,
        has_left=left is not None,
        has_right=right is not None,
        has_head=head is not None,
    )


def _ee_in_head_frame(head: np.ndarray | None, ee: np.ndarray) -> np.ndarray:
    xyz_world = np.asarray(ee[:, :3], dtype=np.float64)
    if head is None or len(head) != len(ee):
        return xyz_world
    out = np.zeros_like(xyz_world)
    for i in range(len(ee)):
        t_head = _pose_to_mat(head[i])
        t_ee = _pose_to_mat(ee[i])
        rel = np.linalg.inv(t_head) @ t_ee
        out[i] = rel[:3, 3]
    return out


def _pose_to_mat(pose: np.ndarray) -> np.ndarray:
    t = np.eye(4)
    t[:3, :3] = _quat_to_mat(pose[3:7])
    t[:3, 3] = pose[:3]
    return t


def _quat_to_mat(q: np.ndarray) -> np.ndarray:
    w, x, y, z = np.asarray(q, dtype=np.float64)
    n = np.sqrt(w * w + x * x + y * y + z * z) + 1e-12
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def _path_length(xyz: np.ndarray) -> float:
    if len(xyz) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(xyz, axis=0), axis=1).sum())


def _speeds(xyz: np.ndarray, fps: float) -> np.ndarray:
    if len(xyz) < 2:
        return np.zeros(1)
    return np.linalg.norm(np.diff(xyz, axis=0), axis=1) * fps


def _rotation_path(quats: np.ndarray) -> float:
    total = 0.0
    for a, b in zip(quats[:-1], quats[1:]):
        a = a / (np.linalg.norm(a) + 1e-12)
        b = b / (np.linalg.norm(b) + 1e-12)
        dot = float(np.clip(abs(np.dot(a, b)), 0.0, 1.0))
        total += 2.0 * np.arccos(dot)
    return float(total)


def _l2_normalize(x: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    n = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / (n + eps)
