from __future__ import annotations

import pandas as pd

from scripts.select_real_comparison import (
    EPISODES_PER_SUBSET,
    TASK_FAMILY_QUOTAS,
    select_comparison,
)


def test_real_selector_produces_unique_matched_subsets():
    task_names = {
        "folding_laundry": "freeform_folding_clothes",
        "groceries": "freeform_bagging_groceries",
        "object_in_container": "flagship_put_object_in_container",
        "cup_on_saucer": "flagship_put_cup_on_saucer",
        "sort_utensils": "flagship_sort_utensils",
    }
    rows = []
    for family, quota in TASK_FAMILY_QUOTAS.items():
        for source in ("scale", "aria"):
            for index in range(quota):
                rows.append(
                    {
                        "episode_id": f"{source}-{family}-{index:05d}",
                        "episode_task": task_names[family],
                        "source": source,
                        "duration_s": 20.0 + index % 40,
                    }
                )

    selected = select_comparison(pd.DataFrame(rows))
    assert len(selected) == 2 * EPISODES_PER_SUBSET
    assert not selected["episode_id"].duplicated().any()
    assert selected.groupby("subset").size().to_dict() == {
        "A": EPISODES_PER_SUBSET,
        "B": EPISODES_PER_SUBSET,
    }
    assert set(selected.loc[selected["subset"].eq("A"), "source"]) == {"scale"}
    counts = selected.groupby(["subset", "task_family"]).size().unstack()
    assert counts.loc["A"].equals(counts.loc["B"])
