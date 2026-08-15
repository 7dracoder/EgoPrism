from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.pipeline import load_features
from src.web_payload import comparison_payload


def main() -> None:
    feature_path = ROOT / "artifacts" / "features.parquet"
    output_path = ROOT / "web" / "app" / "data" / "fallback.json"
    preview_source = ROOT / "artifacts" / "previews"
    preview_output = ROOT / "web" / "public" / "episodes"
    if not feature_path.exists():
        raise SystemExit("Feature cache missing. Run scripts/extract.py first.")

    payload = comparison_payload(load_features(feature_path), source="bundled-cache")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    preview_output.mkdir(parents=True, exist_ok=True)
    for episode in payload["episodes"]:
        source = preview_source / f"{episode['id']}.jpg"
        if not source.exists():
            raise SystemExit(f"Preview missing: {source}")
        shutil.copy2(source, preview_output / source.name)

    print(f"wrote {output_path.relative_to(ROOT)}")
    print(f"copied {len(payload['episodes'])} episode previews")


if __name__ == "__main__":
    main()
