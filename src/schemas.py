from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

VALID_EMBODIMENTS = frozenset(
    {
        "human_right_arm",
        "human_left_arm",
        "human_bimanual",
        "eva_right_arm",
        "eva_left_arm",
        "eva_bimanual",
    }
)

IDLE_SPEED_THRESHOLD_MPS = 0.02
N_SAMPLE_FRAMES = 8
DINO_DIM = 384
RNG_SEED = 7
N_BOOTSTRAP = 200
CLUSTER_K_CAP = 8


class EpisodeValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ManifestRow:
    episode_id: str
    zarr_path: str
    task: str
    lab: str
    scene: str
    fps: float
    subset: str = ""


@dataclass
class MotionSignals:
    left_traj_m: float | None = None
    right_traj_m: float | None = None
    ee_speed_median: float | None = None
    ee_speed_p90: float | None = None
    idle_frac: float | None = None
    head_translation_m: float | None = None
    head_rotation_rad: float | None = None
    bimanual_speed_corr: float | None = None
    has_left: bool = False
    has_right: bool = False
    has_head: bool = False

    @property
    def has_motion(self) -> bool:
        return self.has_left or self.has_right or self.has_head


@dataclass
class EpisodeFeatures:
    episode_id: str
    subset: str
    task: str
    lab: str
    scene: str
    fps: float
    n_frames: int
    duration_s: float
    visual_embedding: list[float]
    has_visual: bool
    preview_path: str
    motion: MotionSignals
    sampled_frame_indices: list[int] = field(default_factory=list)
    visual_source: str = "none"

    def to_row(self) -> dict[str, Any]:
        row: dict[str, Any] = {
            "episode_id": self.episode_id,
            "subset": self.subset,
            "task": self.task,
            "lab": self.lab,
            "scene": self.scene,
            "fps": self.fps,
            "n_frames": self.n_frames,
            "duration_s": self.duration_s,
            "visual_embedding": self.visual_embedding,
            "has_visual": self.has_visual,
            "visual_source": self.visual_source,
            "preview_path": self.preview_path,
            "sampled_frame_indices": self.sampled_frame_indices,
            "left_traj_m": self.motion.left_traj_m,
            "right_traj_m": self.motion.right_traj_m,
            "ee_speed_median": self.motion.ee_speed_median,
            "ee_speed_p90": self.motion.ee_speed_p90,
            "idle_frac": self.motion.idle_frac,
            "head_translation_m": self.motion.head_translation_m,
            "head_rotation_rad": self.motion.head_rotation_rad,
            "bimanual_speed_corr": self.motion.bimanual_speed_corr,
            "has_left": self.motion.has_left,
            "has_right": self.motion.has_right,
            "has_head": self.motion.has_head,
            "has_motion": self.motion.has_motion,
        }
        return row


MOTION_COLUMNS = (
    "left_traj_m",
    "right_traj_m",
    "ee_speed_median",
    "ee_speed_p90",
    "idle_frac",
    "head_translation_m",
    "head_rotation_rad",
    "bimanual_speed_corr",
)
