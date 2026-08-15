import type { ComparisonData, Episode, Occupancy, SubsetSummary } from "./types";

export const DEMO_EPISODES_PER_SUBSET = 6_000;
export const DEMO_TOTAL_EPISODES = DEMO_EPISODES_PER_SUBSET * 2;
export const SCALED_DEMO_SOURCE = "scaled-synthetic-summary";

const RAW_PROTOTYPE_ID_RE = /^fold_[ab]_\d{3}$/;
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

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function isRawPrototypeComparison(data: ComparisonData) {
  return (
    data.task === "fold-clothes" &&
    data.episodes.length === 32 &&
    data.subsetA.episodes === 16 &&
    data.subsetB.episodes === 16 &&
    data.episodes.every((episode) => RAW_PROTOTYPE_ID_RE.test(episode.id))
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

function quantile(values: number[], probability: number) {
  const ordered = values.toSorted((a, b) => a - b);
  const position = (ordered.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = ordered[lowerIndex]!;
  const upper = ordered[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
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

function bootstrapConfidenceInterval(
  episodes: Episode[],
  clusterCount: number,
  method: ComparisonData["method"],
  seed: number,
): [number, number] {
  const random = seededRandom(seed);
  const scores: number[] = [];
  for (let sampleIndex = 0; sampleIndex < method.bootstrapSamples; sampleIndex += 1) {
    const visualCounts = Array.from({ length: clusterCount }, () => 0);
    const motionCounts = Array.from({ length: clusterCount }, () => 0);
    for (let episodeIndex = 0; episodeIndex < episodes.length; episodeIndex += 1) {
      const episode = episodes[Math.floor(random() * episodes.length)]!;
      visualCounts[episode.visualCluster] += 1;
      if (episode.motionCluster >= 0) motionCounts[episode.motionCluster] += 1;
    }
    scores.push(scoreFromOccupancy(
      visualCounts.map((count, cluster) => ({ cluster, count })),
      motionCounts.map((count, cluster) => ({ cluster, count })),
      method,
    ));
  }
  const tail = (1 - method.confidenceLevel) / 2;
  return [round(quantile(scores, tail)), round(quantile(scores, 1 - tail))];
}

function summarizeSubset(
  original: SubsetSummary,
  episodes: Episode[],
  clusterCount: number,
  method: ComparisonData["method"],
  seed: number,
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
    ci: bootstrapConfidenceInterval(episodes, clusterCount, method, seed),
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
  if (data.source === SCALED_DEMO_SOURCE || !isRawPrototypeComparison(data)) return data;

  const subsetA = expandSubset(data.episodes.filter((episode) => episode.subset === "A"), "A");
  const subsetB = expandSubset(data.episodes.filter((episode) => episode.subset === "B"), "B");
  const summaryA = summarizeSubset(data.subsetA, subsetA, data.clusterCount, data.method, 4_101);
  const summaryB = summarizeSubset(data.subsetB, subsetB, data.clusterCount, data.method, 8_203);
  const intervalsOverlap = summaryA.ci[1] >= summaryB.ci[0] && summaryB.ci[1] >= summaryA.ci[0];
  const gap = Math.abs(summaryB.score - summaryA.score);
  const winner = intervalsOverlap || gap < data.method.minimumWinnerGap
    ? "tie"
    : summaryB.score > summaryA.score ? "B" : "A";

  return {
    ...data,
    source: SCALED_DEMO_SOURCE,
    winner,
    statement: winner === "tie"
      ? "No clear difference — confidence intervals overlap or the gap is small."
      : `Subset ${winner} covers more distinct visual contexts and manipulation patterns than subset ${winner === "A" ? "B" : "A"}.`,
    notes: [
      ...data.notes,
      `${DEMO_TOTAL_EPISODES.toLocaleString("en-US")} deterministic summary records are expanded from 32 schema-faithful raw prototypes for scale testing.`,
      "The scaled synthetic corpus and its bootstrap intervals are demo evidence, not a scientific EgoVerse result.",
    ],
    subsetA: summaryA,
    subsetB: summaryB,
    episodes: [...subsetA, ...subsetB],
  };
}
