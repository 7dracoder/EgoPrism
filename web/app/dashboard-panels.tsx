"use client";

import Image from "next/image";
import { BarChart3, Eye, Grid3X3, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import type { ComparisonData, Episode, Occupancy, SubsetSummary } from "./data/types";

export type PanelId = "projection" | "clusters" | "scores" | "episodes";

export const panelOptions: Array<{ id: PanelId; label: string; icon: typeof Eye }> = [
  { id: "projection", label: "Visual map", icon: Eye },
  { id: "clusters", label: "Coverage", icon: Grid3X3 },
  { id: "scores", label: "Scores + CI", icon: BarChart3 },
  { id: "episodes", label: "Episodes", icon: ImageIcon },
];

const UNDERSCORE_RE = /_/g;
const MAX_PROJECTION_POINTS = 320;

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

const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function projectionSample(episodes: Episode[], maximum: number) {
  if (episodes.length <= maximum) return episodes;

  const buckets = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const key = `${episode.subset}:${episode.visualCluster}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(episode);
    else buckets.set(key, [episode]);
  }

  const sampled: Episode[] = [];
  const sampledIds = new Set<string>();
  const quota = Math.max(1, Math.floor(maximum / buckets.size));
  for (const bucket of buckets.values()) {
    const take = Math.min(quota, bucket.length);
    for (let index = 0; index < take; index += 1) {
      const episode = bucket[Math.floor(((index + 0.5) * bucket.length) / take)]!;
      sampled.push(episode);
      sampledIds.add(episode.id);
    }
  }

  const stride = episodes.length / Math.max(1, maximum - sampled.length);
  for (let cursor = 0; sampled.length < maximum && cursor < episodes.length; cursor += stride) {
    const episode = episodes[Math.floor(cursor)]!;
    if (!sampledIds.has(episode.id)) {
      sampled.push(episode);
      sampledIds.add(episode.id);
    }
  }
  for (const episode of episodes) {
    if (sampled.length >= maximum) break;
    if (!sampledIds.has(episode.id)) sampled.push(episode);
  }
  return sampled.slice(0, maximum);
}

function ScatterPlot({
  episodes,
  selectedEpisode,
  onSelect,
}: {
  episodes: Episode[];
  selectedEpisode: Episode;
  onSelect: (episode: Episode) => void;
}) {
  const projection = useMemo(() => {
    let minX = episodes[0]!.x;
    let maxX = episodes[0]!.x;
    let minY = episodes[0]!.y;
    let maxY = episodes[0]!.y;
    for (let index = 1; index < episodes.length; index += 1) {
      const episode = episodes[index]!;
      if (episode.x < minX) minX = episode.x;
      if (episode.x > maxX) maxX = episode.x;
      if (episode.y < minY) minY = episode.y;
      if (episode.y > maxY) maxY = episode.y;
    }
    return { minX, maxX, minY, maxY, sampled: projectionSample(episodes, MAX_PROJECTION_POINTS) };
  }, [episodes]);

  const positioned = useMemo(() => {
    const sampled = projection.sampled.some((episode) => episode.id === selectedEpisode.id)
      ? projection.sampled
      : [...projection.sampled.slice(0, -1), selectedEpisode];
    const { minX, maxX, minY, maxY } = projection;
    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;
    return sampled.map((episode) => ({
      episode,
      left: 5 + ((episode.x - minX) / xRange) * 90,
      top: 7 + (1 - (episode.y - minY) / yRange) * 86,
    }));
  }, [projection, selectedEpisode]);

  return (
    <div
      className="viz-scatter"
      role="group"
      aria-label={`Representative two-dimensional visual projection of ${positioned.length} from ${episodes.length} episodes. Nearby points are visually similar; position is not the score.`}
    >
      <span className="viz-scatter__axis viz-scatter__axis--x">projection axis 1</span>
      <span className="viz-scatter__axis viz-scatter__axis--y">projection axis 2</span>
      {positioned.map(({ episode, left, top }) => (
        <button
          type="button"
          key={episode.id}
          className="viz-scatter__point"
          data-subset={episode.subset}
          data-selected={selectedEpisode.id === episode.id}
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
      <PanelHeader
        index="01"
        title="Visual projection"
        detail={`PCA → UMAP · ${Math.min(MAX_PROJECTION_POINTS, data.episodes.length).toLocaleString()} of ${data.episodes.length.toLocaleString()} points`}
      />
      <div className="viz-legend" aria-label="Projection legend">
        <span><i data-subset="A" /> A square</span>
        <span><i data-subset="B" /> B circle</span>
        <span>numeral = cluster</span>
      </div>
      <ScatterPlot
        episodes={data.episodes}
        selectedEpisode={selectedEpisode}
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
              <small title={`${countA.toLocaleString()} / ${countB.toLocaleString()}`}>
                {compactCount.format(countA)} / {compactCount.format(countB)}
              </small>
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
  return (
    preview.startsWith("/episodes/") ||
    preview.startsWith("data:image/") ||
    preview.startsWith("https://ts5789--egoprism-api-preview.modal.run")
  );
}

function EpisodePreview({ episode, compact = false }: { episode: Episode; compact?: boolean }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [episode.preview]);

  return canDisplayPreview(episode.preview) && !failed ? (
    <Image
      src={episode.preview}
      alt={`Representative frame from ${episode.id}`}
      fill
      sizes={compact ? "8rem" : "(max-width: 52rem) 45vw, 24vw"}
      quality={90}
      unoptimized={episode.preview.startsWith("data:image/")}
      loading={compact ? "lazy" : "eager"}
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="episode-placeholder"><ImageIcon aria-hidden="true" size={compact ? 16 : 24} />Preview restricted</span>
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
  const ranked = useMemo(() => {
    const highest: Episode[] = [];
    for (const episode of data.episodes) {
      const insertionIndex = highest.findIndex((candidate) => episode.novelty > candidate.novelty);
      if (insertionIndex === -1) highest.push(episode);
      else highest.splice(insertionIndex, 0, episode);
      if (highest.length > 6) highest.pop();
    }
    return highest;
  }, [data.episodes]);

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
          <p>{label(selectedEpisode.task || selectedEpisode.scene)} · {label(selectedEpisode.source || selectedEpisode.lab)}</p>
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
