import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.synth import write_demo_subsets

if __name__ == "__main__":
    a, b = write_demo_subsets()
    print(f"wrote {a.relative_to(ROOT)} and {b.relative_to(ROOT)}")
    n = len(list((ROOT / "data" / "episodes").glob("*.zarr")))
    print(f"episodes: {n}")
