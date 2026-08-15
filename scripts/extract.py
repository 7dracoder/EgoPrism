import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.pipeline import compare_cached, run_extraction

if __name__ == "__main__":
    frame = run_extraction()
    result = compare_cached()
    print(f"extracted {len(frame)} episodes")
    print(
        f"A={result.subset_a.score:.1f} [{result.subset_a.ci_low:.1f}, {result.subset_a.ci_high:.1f}]  "
        f"B={result.subset_b.score:.1f} [{result.subset_b.ci_low:.1f}, {result.subset_b.ci_high:.1f}]"
    )
    print(f"winner={result.winner}")
    print(result.statement)
