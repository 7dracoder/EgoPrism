from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MANIFEST_DIR = DATA_DIR / "manifests"
EPISODE_DIR = DATA_DIR / "episodes"
ARTIFACT_DIR = ROOT / "artifacts"
PREVIEW_DIR = ARTIFACT_DIR / "previews"
ASSETS_DIR = ROOT / "assets"
FEATURE_PARQUET = ARTIFACT_DIR / "features.parquet"
SCORE_JSON = ARTIFACT_DIR / "scores.json"
