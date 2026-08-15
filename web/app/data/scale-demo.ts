import type { ComparisonData, Episode, Occupancy, SubsetSummary } from "./types";

export const DEMO_EPISODES_PER_SUBSET = 6_000;
export const DEMO_TOTAL_EPISODES = DEMO_EPISODES_PER_SUBSET * 2;
export const SCALED_INITIAL_SOURCE = "scaled-episode-summary";

const ROUNDING_FACTOR = 1_000_000;

function round(value: number) {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function deterministicNoise(index: number, salt: number) {
  let value = Math.imul(index + 1 + salt, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_296;
}

function isScalableInitialComparison(data: ComparisonData) {
  const subsetACount = data.episodes.filter((episode) => episode.subset === "A").length;
  const subsetBCount = data.episodes.length - subsetACount;
  return (
    data.source !== SCALED_INITIAL_SOURCE &&
    data.task.replaceAll("_", "-") === "fold-clothes" &&
    data.episodes.length > 1 &&
    data.episodes.length < DEMO_TOTAL_EPISODES &&
    subsetACount > 0 &&
    subsetACount === subsetBCount &&
    data.subsetA.episodes === subsetACount &&
    data.subsetB.episodes === subsetBCount
  );
}

function expandSubset(templates: Episode[], subset: "A" | "B") {
  return Array.from({ length: DEMO_EPISODES_PER_SUBSET }, (_, index) => {
    const template = templates[index % templates.length]!;
    const sequence = index + 1;
    const xJitter = (deterministicNoise(index, subset === "A" ? 11 : 29) - 0.5) * 0.7;
    const yJitter = (deterministicNoise(index, subset === "A" ? 47 : 71) - 0.5) * 0.7;
    const noveltyJitter = (deterministicNoise(index, subset === "A" ? 89 : 107) - 0.5) * 0.24;
    const idleJitter = (deterministicNoise(index, subset === "A" ? 131 : 151) - 0.5) * 0.02;

    return {
      ...template,
      id: `fold_${subset.toLowerCase()}_${String(sequence).padStart(5, "0")}`,
      x: round(template.x + xJitter),
      y: round(template.y + yJitter),
      novelty: round(Math.max(0, template.novelty + noveltyJitter)),
      idleFraction: template.idleFraction === null
        ? null
        : round(clamp(template.idleFraction + idleJitter, 0, 1)),
    } satisfies Episode;
  });
}

function occupancy(episodes: Episode[], clusterCount: number, field: "visualCluster" | "motionCluster") {
  const counts = Array.from({ length: clusterCount }, () => 0);
  for (const episode of episodes) {
    const cluster = episode[field];
    if (cluster >= 0 && cluster < clusterCount) counts[cluster] += 1;
  }
  return counts.map((count, cluster) => ({ cluster, count }));
}

function normalizedEntropy(items: Occupancy[]) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total === 0 || items.length <= 1) return 0;
  let entropy = 0;
  for (const item of items) {
    if (item.count === 0) continue;
    const probability = item.count / total;
    entropy -= probability * Math.log(probability);
  }
  return entropy / Math.log(items.length);
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = values.toSorted((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function scoreFromOccupancy(
  visual: Occupancy[],
  motion: Occupancy[],
  method: ComparisonData["method"],
) {
  return 100 * (
    method.visualWeight * normalizedEntropy(visual) +
    method.motionWeight * normalizedEntropy(motion)
  );
}

function summarizeSubset(
  original: SubsetSummary,
  episodes: Episode[],
  clusterCount: number,
  method: ComparisonData["method"],
): SubsetSummary {
  const visualOccupancy = occupancy(episodes, clusterCount, "visualCluster");
  const motionOccupancy = occupancy(episodes, clusterCount, "motionCluster");
  const visualEntropy = normalizedEntropy(visualOccupancy);
  const motionEntropy = method.motionWeight === 0 ? null : normalizedEntropy(motionOccupancy);
  const score = scoreFromOccupancy(visualOccupancy, motionOccupancy, method);
  const idleValues = episodes.flatMap((episode) =>
    episode.idleFraction === null ? [] : [episode.idleFraction]
  );

  return {
    ...original,
    score: round(score),
    // UI-scale duplication must not pretend to add statistical evidence.
    ci: original.ci,
    episodes: episodes.length,
    scenes: new Set(episodes.map((episode) => episode.scene)).size,
    labs: new Set(episodes.map((episode) => episode.lab)).size,
    durationSeconds: round(episodes.reduce((sum, episode) => sum + episode.durationSeconds, 0)),
    visualEntropy: round(visualEntropy),
    motionEntropy: motionEntropy === null ? null : round(motionEntropy),
    visualClustersUsed: visualOccupancy.filter((item) => item.count > 0).length,
    motionClustersUsed: motionOccupancy.filter((item) => item.count > 0).length,
    visualOccupancy,
    motionOccupancy,
    medianIdleFraction: median(idleValues),
  };
}

export function scaleDemoComparison(data: ComparisonData): ComparisonData {
  if (!isScalableInitialComparison(data)) return data;

  const subsetA = expandSubset(data.episodes.filter((episode) => episode.subset === "A"), "A");
  const subsetB = expandSubset(data.episodes.filter((episode) => episode.subset === "B"), "B");
  const summaryA = summarizeSubset(data.subsetA, subsetA, data.clusterCount, data.method);
  const summaryB = summarizeSubset(data.subsetB, subsetB, data.clusterCount, data.method);
  const intervalsOverlap = summaryA.ci[1] >= summaryB.ci[0] && summaryB.ci[1] >= summaryA.ci[0];
  const gap = Math.abs(summaryB.score - summaryA.score);
  const winner = intervalsOverlap || gap < data.method.minimumWinnerGap
    ? "tie"
    : summaryB.score > summaryA.score ? "B" : "A";

  return {
    ...data,
    source: SCALED_INITIAL_SOURCE,
    winner,
    statement: winner === "tie"
      ? "No clear difference — confidence intervals overlap or the gap is small."
      : `Subset ${winner} covers more distinct visual contexts and manipulation patterns than subset ${winner === "A" ? "B" : "A"}.`,
    notes: [
      ...data.notes,
      `${DEMO_TOTAL_EPISODES.toLocaleString("en-US")} deterministic summary records are expanded from ${data.episodes.length} scored source episodes for interface-scale testing.`,
      `Confidence intervals remain those of the ${data.episodes.length} source episodes; repeated summaries do not add statistical evidence.`,
    ],
    subsetA: summaryA,
    subsetB: summaryB,
    episodes: [...subsetA, ...subsetB],
  };
}
