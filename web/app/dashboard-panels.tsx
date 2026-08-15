"use client";

import Image from "next/image";
import { BarChart3, Eye, Grid3X3, ImageIcon } from "lucide-react";
import { useMemo, type CSSProperties } from "react";

import type { ComparisonData, Episode, Occupancy, SubsetSummary } from "./data/types";

export type PanelId = "projection" | "clusters" | "scores" | "episodes";

export const panelOptions: Array<{ id: PanelId; label: string; icon: typeof Eye }> = [
  { id: "projection", label: "Visual map", icon: Eye },
  { id: "clusters", label: "Coverage", icon: Grid3X3 },
  { id: "scores", label: "Scores + CI", icon: BarChart3 },
  { id: "episodes", label: "Episodes", icon: ImageIcon },
];

const UNDERSCORE_RE = /_/g;

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

const label = (value: string) => value.replace(UNDERSCORE_RE, " ");

function PanelHeader({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <header className="viz-panel__head">
      <span>{index}</span>
      <div><h2>{title}</h2><p>{detail}</p></div>
    </header>
  );
}

function occupancyCount(items: Occupancy[], cluster: number) {
  return items.find((item) => item.cluster === cluster)?.count ?? 0;
}

function ScatterPlot({
  episodes,
  selected,
  onSelect,
}: {
  episodes: Episode[];
  selected: string;
  onSelect: (episode: Episode) => void;
}) {
  const positioned = useMemo(() => {
    const xs = episodes.map((episode) => episode.x);
    const ys = episodes.map((episode) => episode.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;
    return episodes.map((episode) => ({
      episode,
      left: 5 + ((episode.x - minX) / xRange) * 90,
      top: 7 + (1 - (episode.y - minY) / yRange) * 86,
    }));
  }, [episodes]);

  return (
    <div
      className="viz-scatter"
      role="group"
      aria-label="Two-dimensional visual projection. Nearby points are visually similar; position is not the score."
    >
      <span className="viz-scatter__axis viz-scatter__axis--x">projection axis 1</span>
      <span className="viz-scatter__axis viz-scatter__axis--y">projection axis 2</span>
      {positioned.map(({ episode, left, top }) => (
        <button
          type="button"
          key={episode.id}
          className="viz-scatter__point"
          data-subset={episode.subset}
          data-selected={selected === episode.id}
          style={{ "--point-x": `${left}%`, "--point-y": `${top}%` } as CSSProperties}
          aria-label={`${episode.id}, subset ${episode.subset}, visual cluster ${episode.visualCluster + 1}`}
          onClick={() => onSelect(episode)}
        >
          <span>{episode.visualCluster + 1}</span>
        </button>
      ))}
    </div>
  );
}

export function ProjectionPanel({
  data,
  selectedEpisode,
  onSelect,
}: {
  data: ComparisonData;
  selectedEpisode: Episode;
  onSelect: (episode: Episode) => void;
}) {
  return (
    <article className="viz-panel viz-panel--dark" data-panel="projection">
      <PanelHeader index="01" title="Visual projection" detail="PCA → UMAP · click any episode" />
      <div className="viz-legend" aria-label="Projection legend">
        <span><i data-subset="A" /> A square</span>
        <span><i data-subset="B" /> B circle</span>
        <span>numeral = cluster</span>
      </div>
      <ScatterPlot
        episodes={data.episodes}
        selected={selectedEpisode.id}
        onSelect={onSelect}
      />
      <div className="viz-selected" aria-live="polite">
        <span>Selected</span>
        <strong>{selectedEpisode.id}</strong>
        <span>Subset {selectedEpisode.subset}</span>
        <span>C{selectedEpisode.visualCluster + 1}</span>
        <span>{label(selectedEpisode.scene)}</span>
        <span>novelty {selectedEpisode.novelty.toFixed(2)}</span>
      </div>
    </article>
  );
}

function PairedBars({
  title,
  clusterCount,
  occupancyA,
  occupancyB,
}: {
  title: string;
  clusterCount: number;
  occupancyA: Occupancy[];
  occupancyB: Occupancy[];
}) {
  const maxCount = Math.max(
    ...occupancyA.map((item) => item.count),
    ...occupancyB.map((item) => item.count),
    1,
  );

  return (
    <section className="paired-chart" aria-label={`${title} occupancy`}>
      <header><strong>{title}</strong><span>A / B</span></header>
      <div className="paired-chart__rows">
        {Array.from({ length: clusterCount }, (_, clusterIndex) => {
          const countA = occupancyCount(occupancyA, clusterIndex);
          const countB = occupancyCount(occupancyB, clusterIndex);
          return (
            <div
              className="paired-chart__row"
              key={clusterIndex}
              role="img"
              aria-label={`Cluster ${clusterIndex + 1}: ${countA} A episodes and ${countB} B episodes`}
            >
              <span>C{clusterIndex + 1}</span>
              <div>
                <i data-subset="A" style={{ "--bar-width": `${(countA / maxCount) * 100}%` } as CSSProperties} />
                <i data-subset="B" style={{ "--bar-width": `${(countB / maxCount) * 100}%` } as CSSProperties} />
              </div>
              <small>{countA} / {countB}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ClusterPanel({ data }: { data: ComparisonData }) {
  return (
    <article className="viz-panel" data-panel="clusters">
      <PanelHeader index="02" title="Cluster coverage" detail="Paired occupancy · upper A, lower B" />
      <div className="paired-charts">
        <PairedBars
          title="Visual clusters"
          clusterCount={data.clusterCount}
          occupancyA={data.subsetA.visualOccupancy}
          occupancyB={data.subsetB.visualOccupancy}
        />
        <PairedBars
          title="Motion clusters"
          clusterCount={data.clusterCount}
          occupancyA={data.subsetA.motionOccupancy}
          occupancyB={data.subsetB.motionOccupancy}
        />
      </div>
      <div className="cluster-summary">
        <div><span>A visual</span><strong>{data.subsetA.visualClustersUsed}/{data.clusterCount}</strong></div>
        <div><span>B visual</span><strong>{data.subsetB.visualClustersUsed}/{data.clusterCount}</strong></div>
        <div><span>A idle</span><strong>{percent(data.subsetA.medianIdleFraction)}</strong></div>
        <div><span>B idle</span><strong>{percent(data.subsetB.medianIdleFraction)}</strong></div>
      </div>
    </article>
  );
}

function ScoreRow({ subset }: { subset: SubsetSummary }) {
  return (
    <div className="score-anatomy__row" data-subset={subset.name}>
      <span>Subset {subset.name}</span>
      <strong>{subset.score.toFixed(1)}</strong>
      <div className="score-anatomy__rail" aria-label={`Subset ${subset.name} score ${subset.score.toFixed(1)} out of 100`}>
        <i style={{ "--score-width": `${Math.max(0, Math.min(100, subset.score))}%` } as CSSProperties} />
      </div>
      <small>visual {percent(subset.visualEntropy)} · motion {percent(subset.motionEntropy)}</small>
    </div>
  );
}

function ConfidenceRow({ subset }: { subset: SubsetSummary }) {
  const start = Math.max(0, Math.min(100, subset.ci[0]));
  const end = Math.max(start, Math.min(100, subset.ci[1]));
  const point = Math.max(0, Math.min(100, subset.score));
  return (
    <div className="confidence-row" data-subset={subset.name}>
      <span>{subset.name}</span>
      <div className="confidence-row__axis">
        <i
          className="confidence-row__range"
          style={{ "--ci-start": `${start}%`, "--ci-width": `${end - start}%` } as CSSProperties}
        />
        <i className="confidence-row__point" style={{ "--score-point": `${point}%` } as CSSProperties} />
      </div>
      <small>{subset.ci[0].toFixed(1)}–{subset.ci[1].toFixed(1)}</small>
    </div>
  );
}

export function ScoresPanel({ data }: { data: ComparisonData }) {
  const delta = data.subsetB.score - data.subsetA.score;
  return (
    <article className="viz-panel" data-panel="scores">
      <PanelHeader index="03" title="Score anatomy" detail="Coverage entropy + 95% bootstrap CI" />
      <div className="score-outcome">
        <span>{data.winner === "tie" ? "No clear winner" : `Subset ${data.winner} leads`}</span>
        <strong>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</strong>
        <small>point gap</small>
      </div>
      <div className="score-anatomy">
        <ScoreRow subset={data.subsetA} />
        <ScoreRow subset={data.subsetB} />
      </div>
      <section className="confidence-chart" aria-label="95 percent confidence intervals">
        <header><strong>Confidence intervals</strong><span>0</span><span>50</span><span>100</span></header>
        <ConfidenceRow subset={data.subsetA} />
        <ConfidenceRow subset={data.subsetB} />
      </section>
      <p className="score-note">Winner only when intervals separate and gap ≥ {data.method.minimumWinnerGap.toFixed(0)}. Coverage does not guarantee policy success.</p>
    </article>
  );
}

function canDisplayPreview(preview: string) {
  return preview.startsWith("/episodes/") || preview.startsWith("data:image/");
}

function EpisodePreview({ episode, compact = false }: { episode: Episode; compact?: boolean }) {
  return canDisplayPreview(episode.preview) ? (
    <Image
      src={episode.preview}
      alt={`Representative frame from ${episode.id}`}
      fill
      sizes={compact ? "8rem" : "(max-width: 52rem) 45vw, 18vw"}
      unoptimized={episode.preview.startsWith("data:image/")}
    />
  ) : (
    <span className="episode-placeholder"><ImageIcon aria-hidden="true" size={compact ? 16 : 24} />No local preview</span>
  );
}

export function EpisodesPanel({
  data,
  selectedEpisode,
  onSelect,
}: {
  data: ComparisonData;
  selectedEpisode: Episode;
  onSelect: (episode: Episode) => void;
}) {
  const ranked = useMemo(
    () => data.episodes.toSorted((a, b) => b.novelty - a.novelty).slice(0, 6),
    [data.episodes],
  );

  return (
    <article className="viz-panel" data-panel="episodes">
      <PanelHeader index="04" title="Episode inspector" detail="Click a frame to trace the evidence" />
      <div className="episode-inspector">
        <figure className="episode-inspector__media" data-subset={selectedEpisode.subset}>
          <EpisodePreview episode={selectedEpisode} />
          <figcaption>Subset {selectedEpisode.subset}</figcaption>
        </figure>
        <div className="episode-inspector__details">
          <span>Selected episode</span>
          <strong>{selectedEpisode.id}</strong>
          <p>{label(selectedEpisode.scene)} · {label(selectedEpisode.lab)}</p>
          <dl>
            <div><dt>visual cluster</dt><dd>C{selectedEpisode.visualCluster + 1}</dd></div>
            <div><dt>motion cluster</dt><dd>{selectedEpisode.motionCluster >= 0 ? `C${selectedEpisode.motionCluster + 1}` : "—"}</dd></div>
            <div><dt>novelty</dt><dd>{selectedEpisode.novelty.toFixed(2)}</dd></div>
            <div><dt>idle</dt><dd>{percent(selectedEpisode.idleFraction)}</dd></div>
          </dl>
        </div>
      </div>
      <div className="episode-thumbnails" aria-label="Most novel episodes">
        {ranked.map((episode) => (
          <button
            type="button"
            key={episode.id}
            data-selected={episode.id === selectedEpisode.id}
            data-subset={episode.subset}
            aria-label={`Inspect ${episode.id}`}
            onClick={() => onSelect(episode)}
          >
            <span><EpisodePreview episode={episode} compact /></span>
            <small>{episode.id}</small>
          </button>
        ))}
      </div>
    </article>
  );
}
