from __future__ import annotations

import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import streamlit as st
from PIL import Image

from src.metrics import score_comparison
from src.paths import ASSETS_DIR, FEATURE_PARQUET, ROOT as PROJECT_ROOT
from src.pipeline import load_features
from src.plots import occupancy_figure, umap_figure, motion_figure, COBALT, TEAL
from src.voice import VoiceSynthesisError, api_key_from_env, briefing_script, synthesize_briefing

st.set_page_config(page_title="EgoPrism", layout="wide", page_icon="◈")


@st.cache_data(show_spinner="Mapping dataset diversity…")
def _load_scored_features(cache_path: str, modified_ns: int):
    del modified_ns  # Cache-busting input when the feature artifact changes.
    features = load_features(Path(cache_path))
    return score_comparison(features)


def _css() -> str:
    return (ASSETS_DIR / "style.css").read_text()


def _subset_label(labeled, subset: str) -> str:
    part = labeled[labeled["subset"] == subset]
    scenes = int(part["scene"].nunique())
    labs = int(part["lab"].nunique())
    scene_word = "scene" if scenes == 1 else "scenes"
    lab_word = "lab" if labs == 1 else "labs"
    return f"{scenes} {scene_word} · {labs} {lab_word}"


def _entropy_label(value: float | None) -> str:
    return "n/a" if value is None else f"{100 * value:.0f}"


def _html_scores(result, labeled) -> str:
    a, b = result.subset_a, result.subset_b
    klass = {"B": "win-b", "A": "win-a", "tie": "win-tie"}[result.winner]
    title = {
        "B": "Subset B is more diverse",
        "A": "Subset A is more diverse",
        "tie": "No clear difference",
    }[result.winner]
    a_label = html.escape(_subset_label(labeled, "A"))
    b_label = html.escape(_subset_label(labeled, "B"))
    statement = html.escape(result.statement)
    return f"""
    <div class="score-grid">
      <div class="score-card a">
        <div class="score-overline">Subset A</div>
        <div class="score-label">{a_label}</div>
        <div class="score-value">{a.score:.1f}</div>
        <div class="score-ci">95% CI {a.ci_low:.1f}–{a.ci_high:.1f} · n={a.n_episodes}</div>
        <div class="score-breakdown"><span>visual {_entropy_label(a.visual_entropy)}</span><span>motion {_entropy_label(a.motion_entropy)}</span></div>
      </div>
      <div class="verdict {klass}">
        <div class="verdict-kicker">Decision</div>
        <h3>{title}</h3>
        <p>{statement} Higher means broader cluster coverage—not guaranteed robot-policy success.</p>
      </div>
      <div class="score-card b">
        <div class="score-overline">Subset B</div>
        <div class="score-label">{b_label}</div>
        <div class="score-value">{b.score:.1f}</div>
        <div class="score-ci">95% CI {b.ci_low:.1f}–{b.ci_high:.1f} · n={b.n_episodes}</div>
        <div class="score-breakdown"><span>visual {_entropy_label(b.visual_entropy)}</span><span>motion {_entropy_label(b.motion_entropy)}</span></div>
      </div>
    </div>
    """


def _selected_points(event) -> list:
    if event is None:
        return []
    selection = getattr(event, "selection", None)
    if selection is None:
        return []
    points = getattr(selection, "points", None)
    if points is None and isinstance(selection, dict):
        points = selection.get("points")
    if not points:
        return []
    return list(points)


def _eleven_key() -> str:
    key = str(st.session_state.get("eleven_key") or "").strip() or api_key_from_env()
    if key:
        return key
    try:
        return str(st.secrets.get("ELEVENLABS_API_KEY", "")).strip()
    except Exception:
        return ""


def _briefing_panel(result) -> None:
    script = briefing_script(result)
    key = _eleven_key()
    play_col, key_col = st.columns([1, 2.4], vertical_alignment="center")
    with play_col:
        play = st.button(
            "▶  Play voice briefing",
            use_container_width=True,
            disabled=not bool(key),
            help=(
                "Reads the deterministic ranking with ElevenLabs."
                if key
                else "Add ELEVENLABS_API_KEY to the server environment or Streamlit secrets."
            ),
        )
    with key_col:
        if key:
            st.caption("ElevenLabs ready · reads the result aloud · never influences scoring")
        else:
            st.caption("Voice briefing ready · add the server-side ElevenLabs key when available")
    if play:
        try:
            path = synthesize_briefing(script, api_key=key)
            st.audio(path.read_bytes(), format="audio/mp3", autoplay=True)
        except VoiceSynthesisError as exc:
            st.error(str(exc))
    with st.expander("Briefing script"):
        st.write(script)


def _empty_state():
    st.markdown('<p class="eg-kicker">EgoPrism</p>', unsafe_allow_html=True)
    st.markdown("## Feature cache is empty")
    st.info(
        "Run `python scripts/make_fixtures.py` then `python scripts/extract.py`, "
        "or `modal run modal_extract.py`, then reload."
    )


def main():
    st.markdown(f"<style>{_css()}</style>", unsafe_allow_html=True)
    if not FEATURE_PARQUET.exists():
        _empty_state()
        return

    result = _load_scored_features(
        str(FEATURE_PARQUET), FEATURE_PARQUET.stat().st_mtime_ns
    )
    labeled = result.labeled.copy()
    n = len(labeled)
    scenes = labeled["scene"].nunique()
    quality = result.data_quality

    left, right = st.columns([1.4, 1])
    with left:
        st.markdown(
            f"""
            <div class="eg-kicker">EgoVerse · Track 2</div>
            <h1 class="eg-title">EgoPrism</h1>
            """,
            unsafe_allow_html=True,
        )
        st.caption("Quantitative diversity for two frozen, task-matched subsets.")
    with right:
        chip_q = "eg-chip warn" if result.visual_only else "eg-chip"
        st.markdown(
            f"""
            <div class="eg-meta">
              <span class="eg-chip">{result.task}</span>
              <span class="eg-chip">{n} episodes</span>
              <span class="eg-chip">{scenes} scenes</span>
              <span class="{chip_q}">{quality}</span>
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown(_html_scores(result, labeled), unsafe_allow_html=True)
    if result.notes:
        st.markdown(
            f'<div class="note-banner">{" ".join(result.notes)}</div>',
            unsafe_allow_html=True,
        )
    _briefing_panel(result)

    a, b = result.subset_a, result.subset_b
    st.markdown(
        f"""
        <div class="insight-strip">
          <div><span>Visual coverage</span><strong>{100 * a.visual_entropy:.0f} → {100 * b.visual_entropy:.0f}</strong></div>
          <div><span>Motion coverage</span><strong>{_entropy_label(a.motion_entropy)} → {_entropy_label(b.motion_entropy)}</strong></div>
          <div><span>Clusters</span><strong>K = {result.k}</strong></div>
          <div><span>Decision rule</span><strong>95% CI + 2 pt gap</strong></div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if "cluster_filter" not in st.session_state:
        st.session_state.cluster_filter = None

    st.markdown('<div class="section-kicker">Evidence</div>', unsafe_allow_html=True)
    st.markdown("### See why the score moved")
    c1, c2 = st.columns([1.25, 1])
    with c1:
        with st.container(border=True):
            event = st.plotly_chart(
                umap_figure(labeled, st.session_state.cluster_filter),
                use_container_width=True,
                on_select="rerun",
                selection_mode="points",
                key="umap",
                config={"displayModeBar": False},
            )
        points = _selected_points(event)
        if points:
            cluster = int(points[0]["customdata"][1])
            st.session_state.cluster_filter = cluster
            st.caption(f"Filtered to visual cluster {cluster}.")
    with c2:
        with st.container(border=True):
            st.plotly_chart(
                motion_figure(labeled),
                use_container_width=True,
                config={"displayModeBar": False},
            )

    if result.visual_only:
        st.warning("Motion unused. Score is visual-only.")
    else:
        c3, c4 = st.columns(2)
        with c3:
            with st.container(border=True):
                st.plotly_chart(
                    occupancy_figure(
                        result.subset_a.visual_occupancy,
                        result.subset_b.visual_occupancy,
                        "Visual cluster occupancy",
                    ),
                    use_container_width=True,
                    config={"displayModeBar": False},
                )
        with c4:
            with st.container(border=True):
                st.plotly_chart(
                    occupancy_figure(
                        result.subset_a.motion_occupancy,
                        result.subset_b.motion_occupancy,
                        "Motion cluster occupancy",
                    ),
                    use_container_width=True,
                    config={"displayModeBar": False},
                )

    if st.session_state.cluster_filter is not None:
        if st.button("Clear cluster filter"):
            st.session_state.cluster_filter = None
            st.rerun()

    f1, f2, f3 = st.columns(3)
    subset_opt = f1.selectbox("Subset", ["A + B", "A", "B"])
    labs = ["all"] + sorted(labeled["lab"].unique().tolist())
    lab_opt = f2.selectbox("Lab", labs)
    clusters = ["all"] + [str(i) for i in sorted(labeled["visual_cluster"].unique().tolist())]
    cluster_opt = f3.selectbox("Visual cluster", clusters)

    shown = labeled.copy()
    if st.session_state.cluster_filter is not None:
        shown = shown[shown["visual_cluster"] == st.session_state.cluster_filter]
    if subset_opt != "A + B":
        shown = shown[shown["subset"] == subset_opt]
    if lab_opt != "all":
        shown = shown[shown["lab"] == lab_opt]
    if cluster_opt != "all":
        shown = shown[shown["visual_cluster"] == int(cluster_opt)]
    shown = shown.sort_values("novelty", ascending=False)

    st.markdown("##### Representative episodes, ordered by novelty")
    if shown.empty:
        st.info("No episodes match these filters.")
    else:
        cols = st.columns(4)
        for i, rec in enumerate(shown.head(8).itertuples()):
            path = PROJECT_ROOT / rec.preview_path
            with cols[i % 4]:
                if path.exists():
                    st.image(Image.open(path), use_container_width=True)
                color = COBALT if rec.subset == "A" else TEAL
                episode_id = html.escape(str(rec.episode_id))
                scene = html.escape(str(rec.scene))
                st.markdown(
                    f"<div class='episode-id' style='color:{color}'>{episode_id}</div>"
                    f"<div class='episode-sub'>subset {rec.subset} · {scene} · cluster {rec.visual_cluster}</div>",
                    unsafe_allow_html=True,
                )

    with st.expander("Method, sampling, and limitations"):
        st.markdown(
            f"""
            **Score.** Standardize visual and motion features on the pooled A+B set.
Cluster each family with K = {result.k} (`min(8, floor(sqrt(n)))`).
Normalized cluster entropy is `-sum(p log p) / log(K)`.
Composite score is `50 × visual entropy + 50 × motion entropy` (0–100).
If usable motion is missing, the score is visual-only.

**Sampling.** 8 evenly spaced `images.front_1` frames per episode.
Stored `dino.front_img_1` embeddings are L2-normalized then mean-pooled.
Poses are rewritten into the head/camera frame when `obs_head_pose` exists.
Idle fraction uses a documented speed threshold of **0.02 m/s**.

**Confidence.** Episodes are bootstrapped 200 times. A winner is declared
only when 95% intervals do not overlap and the gap is at least 2 points.

**Not a policy claim.** A higher score means more cluster coverage, not that
every robot policy will succeed more often. Scene and lab labels are
explanatory, not score inputs. The optional ElevenLabs briefing reads this
result aloud; it is not part of the score.

**Data source.** This reference surface reads the active feature cache. The
production web comparison is built from 12,000 independent EgoVerse R2 episodes;
local manifests can still point at a smaller validation cache when testing the
reader.

**Visual source.** {labeled['visual_source'].value_counts().to_dict()}
            """
        )


if __name__ == "__main__":
    main()
