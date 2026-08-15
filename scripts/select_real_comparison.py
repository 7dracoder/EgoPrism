"""Select the reproducible 12,000-episode real EgoPrism comparison.

Subset A is a 6,000-episode single-source Scale baseline. Subset B is a
6,000-episode multi-source EgoVerse slice drawn from Aria, Eva, and Scale.
Both sides have identical task-family quotas, unique episode IDs, and matched
duration distributions. Selection uses stable SHA-256 ordering only.
"""

from __future__ import annotations

from bisect import bisect_left
import hashlib
import json
from pathlib import Path
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.web_payload import comparison_payload  # noqa: E402


TASK_FAMILY_QUOTAS = {
    "folding_laundry": 2_610,
    "groceries": 1_300,
    "object_in_container": 900,
    "cup_on_saucer": 500,
    "sort_utensils": 690,
}
EPISODES_PER_SUBSET = sum(TASK_FAMILY_QUOTAS.values())


def task_family(task: str) -> str:
    value = task.strip().lower()
    if any(term in value for term in ("fold", "laundry", "shirt_on_hanger", "make_bed")):
        return "folding_laundry"
    if "grocer" in value:
        return "groceries"
    if "cup_on_saucer" in value:
        return "cup_on_saucer"
    if any(
        term in value
        for term in ("object_in_container", "objects_to_bins", "rubberbands_in_ziploc")
    ):
        return "object_in_container"
    if "utensil" in value:
        return "sort_utensils"
    return "other"


def stable_key(episode_id: str) -> str:
    return hashlib.sha256(episode_id.encode()).hexdigest()


def duration_match(candidates: pd.DataFrame, targets: pd.DataFrame) -> pd.DataFrame:
    """Greedily match the sorted target durations without reusing candidates."""
    ordered = candidates.sort_values(["duration_s", "stable_key"]).copy()
    durations = ordered["duration_s"].astype(float).tolist()
    records = list(ordered.to_dict(orient="records"))
    selected = []
    for target in targets.sort_values(["duration_s", "stable_key"]).itertuples(index=False):
        value = float(target.duration_s)
        index = bisect_left(durations, value)
        options = []
        if index < len(durations):
            options.append(index)
        if index > 0:
            options.append(index - 1)
        if not options:
            raise ValueError("not enough single-source candidates for duration matching")
        best = min(options, key=lambda item: abs(durations[item] - value))
        selected.append(records.pop(best))
        durations.pop(best)
    return pd.DataFrame(selected)


def select_comparison(features: pd.DataFrame) -> pd.DataFrame:
    frame = features.copy()
    frame["task_family"] = frame["episode_task"].map(task_family)
    frame["stable_key"] = frame["episode_id"].map(stable_key)

    parts_a = []
    parts_b = []
    for family, quota in TASK_FAMILY_QUOTAS.items():
        family_rows = frame[frame["task_family"].eq(family)].copy()
        multi_source = family_rows[~family_rows["source"].eq("scale")].sort_values(
            "stable_key"
        )
        subset_b = multi_source.head(quota)
        if len(subset_b) < quota:
            scale_fill = family_rows[
                family_rows["source"].eq("scale")
            ].sort_values("stable_key").head(quota - len(subset_b))
            subset_b = pd.concat([subset_b, scale_fill], ignore_index=True)
        if len(subset_b) != quota:
            raise ValueError(f"{family}: could not select {quota} multi-source episodes")

        available_a = family_rows[
            family_rows["source"].eq("scale")
            & ~family_rows["episode_id"].isin(subset_b["episode_id"])
        ]
        if len(available_a) < quota:
            raise ValueError(f"{family}: not enough independent Scale episodes")
        subset_a = duration_match(available_a, subset_b)
        parts_a.append(subset_a.assign(subset="A", comparison_role="single_source_scale"))
        parts_b.append(subset_b.assign(subset="B", comparison_role="multi_source"))

    selected = pd.concat([*parts_a, *parts_b], ignore_index=True)
    selected["task"] = "matched_household_tasks"
    selected = selected.drop(columns=["stable_key"])
    _validate_selection(selected)
    return selected


def _validate_selection(frame: pd.DataFrame) -> None:
    counts = frame.groupby("subset").size().to_dict()
    if counts != {"A": EPISODES_PER_SUBSET, "B": EPISODES_PER_SUBSET}:
        raise ValueError(f"unexpected subset counts: {counts}")
    if frame["episode_id"].duplicated().any():
        raise ValueError("selected comparison contains duplicate episode IDs")
    family_counts = frame.groupby(["subset", "task_family"]).size().unstack(fill_value=0)
    if not family_counts.loc["A"].equals(family_counts.loc["B"]):
        raise ValueError("task-family counts differ between subsets")
    durations = frame.groupby("subset")["duration_s"].sum()
    duration_gap = abs(float(durations["A"] - durations["B"])) / max(
        float(durations.max()), 1.0
    )
    if duration_gap > 0.05:
        raise ValueError(f"duration mismatch is {duration_gap:.1%}, expected at most 5%")


def main() -> None:
    source = ROOT / "artifacts" / "features-real.parquet"
    if not source.exists():
        raise SystemExit("features-real.parquet is missing; run modal_real_pipeline.py first")
    selected = select_comparison(pd.read_parquet(source))
    feature_output = ROOT / "artifacts" / "features.parquet"
    feature_backup = ROOT / "artifacts" / "features-real-comparison.parquet"
    summary_output = ROOT / "artifacts" / "real-summary.json"
    selected.to_parquet(feature_output, index=False)
    selected.to_parquet(feature_backup, index=False)

    payload = comparison_payload(selected, source="modal-real")
    payload["notes"] = [
        "Subset A is a single-source Scale baseline; subset B is a multi-source Aria, Eva, and Scale slice.",
        "Both subsets contain 6,000 unique episodes with identical task-family quotas and matched total duration.",
        *payload["notes"],
    ]
    summary_output.write_text(json.dumps(payload, separators=(",", ":")))

    durations = selected.groupby("subset")["duration_s"].sum().to_dict()
    report = {
        "episodes": int(len(selected)),
        "subset_counts": {
            str(key): int(value)
            for key, value in selected.groupby("subset").size().items()
        },
        "task_family_counts": {
            f"{subset}:{family}": int(value)
            for (subset, family), value in selected.groupby(
                ["subset", "task_family"]
            ).size().items()
        },
        "source_counts": {
            f"{subset}:{source_name}": int(value)
            for (subset, source_name), value in selected.groupby(
                ["subset", "source"]
            ).size().items()
        },
        "duration_hours": {
            str(key): round(float(value) / 3600.0, 2)
            for key, value in durations.items()
        },
        "score_a": payload["subsetA"]["score"],
        "score_b": payload["subsetB"]["score"],
        "ci_a": payload["subsetA"]["ci"],
        "ci_b": payload["subsetB"]["ci"],
        "winner": payload["winner"],
        "summary_bytes": summary_output.stat().st_size,
    }
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
