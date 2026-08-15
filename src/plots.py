from __future__ import annotations

import plotly.graph_objects as go
import pandas as pd

COBALT = "#3B5BDB"
TEAL = "#0CA678"
NAVY = "#0F2744"
MUTED = "#5C6570"
AMBER = "#E67700"
GRID = "#E6E1D6"
A_MARKER = "circle"
B_MARKER = "diamond"


def umap_figure(frame: pd.DataFrame, highlight_cluster: int | None = None) -> go.Figure:
    fig = go.Figure()
    for subset, color, symbol in (("A", COBALT, A_MARKER), ("B", TEAL, B_MARKER)):
        part = frame[frame["subset"] == subset]
        if highlight_cluster is not None:
            faded = part[part["visual_cluster"] != highlight_cluster]
            focus = part[part["visual_cluster"] == highlight_cluster]
            layers = [(faded, 0.22), (focus, 1.0)]
        else:
            layers = [(part, 1.0)]
        for chunk, opacity in layers:
            if chunk.empty:
                continue
            fig.add_trace(
                go.Scatter(
                    x=chunk["x"],
                    y=chunk["y"],
                    mode="markers",
                    name=f"Subset {subset}",
                    legendgroup=subset,
                    showlegend=opacity == 1.0,
                    marker=dict(
                        size=11 + 10 * (chunk["novelty"] / (chunk["novelty"].max() + 1e-9)),
                        color=color,
                        symbol=symbol,
                        opacity=opacity,
                        line=dict(width=0.6, color="white"),
                    ),
                    customdata=list(
                        zip(
                            chunk["episode_id"],
                            chunk["visual_cluster"],
                            chunk["novelty"].round(3),
                            chunk["scene"],
                            chunk["lab"],
                            chunk["preview_path"],
                        )
                    ),
                    hovertemplate=(
                        "<b>%{customdata[0]}</b><br>"
                        "subset " + subset + " · cluster %{customdata[1]}<br>"
                        "scene %{customdata[3]} · lab %{customdata[4]}<br>"
                        "novelty %{customdata[2]}<extra></extra>"
                    ),
                )
            )
    fig.update_layout(**_layout("Visual coverage (2D projection)", height=420))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    return fig


def occupancy_figure(occ_a: dict, occ_b: dict, title: str) -> go.Figure:
    keys = sorted(set(occ_a) | set(occ_b))
    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=[f"C{k}" for k in keys],
            y=[occ_a.get(k, 0) for k in keys],
            name="Subset A",
            marker_color=COBALT,
        )
    )
    fig.add_trace(
        go.Bar(
            x=[f"C{k}" for k in keys],
            y=[occ_b.get(k, 0) for k in keys],
            name="Subset B",
            marker_color=TEAL,
        )
    )
    fig.update_layout(**_layout(title, height=340), barmode="group", bargap=0.28)
    fig.update_yaxes(title_text="episodes", gridcolor=GRID, zeroline=False)
    fig.update_xaxes(title_text="cluster")
    return fig


def motion_figure(frame: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    for subset, color in (("A", COBALT), ("B", TEAL)):
        part = frame[frame["subset"] == subset]
        fig.add_trace(
            go.Box(
                y=part["idle_frac"],
                name=f"{subset} idle",
                marker_color=color,
                boxmean=True,
                jitter=0.35,
                pointpos=0,
                boxpoints="all",
            )
        )
    fig.update_layout(**_layout("Idle fraction by subset", height=420), showlegend=False)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, tickformat=".0%", title_text="idle frames")
    return fig


def _layout(title: str, *, height: int) -> dict:
    return dict(
        title=dict(
            text=title,
            font=dict(family="Inter, sans-serif", size=15, color=NAVY),
            x=0.02,
            y=0.97,
        ),
        height=height,
        font=dict(family="Inter, sans-serif", color=NAVY, size=12),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="#FBFAF7",
        margin=dict(l=20, r=14, t=68, b=42),
        legend=dict(
            orientation="h",
            y=1.14,
            x=1,
            xanchor="right",
            font=dict(size=10),
        ),
        hoverlabel=dict(bgcolor="white", font_size=12, font_family="Inter, sans-serif"),
    )
