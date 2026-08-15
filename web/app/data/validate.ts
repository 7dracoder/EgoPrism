import type { ComparisonData, Episode, Occupancy, SubsetSummary } from "./types";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value);

function isOccupancy(value: unknown): value is Occupancy {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Occupancy>;
  return Number.isInteger(item.cluster) && Number.isInteger(item.count) && (item.count ?? -1) >= 0;
}

function isSubsetSummary(value: unknown, expectedName: "A" | "B"): value is SubsetSummary {
  if (!value || typeof value !== "object") return false;
  const subset = value as Partial<SubsetSummary>;
  return (
    subset.name === expectedName &&
    isFiniteNumber(subset.score) &&
    Array.isArray(subset.ci) &&
    subset.ci.length === 2 &&
    subset.ci.every(isFiniteNumber) &&
    Number.isInteger(subset.episodes) &&
    (subset.episodes ?? 0) > 0 &&
    Number.isInteger(subset.scenes) &&
    Number.isInteger(subset.labs) &&
    isFiniteNumber(subset.durationSeconds) &&
    isFiniteNumber(subset.visualEntropy) &&
    isNullableNumber(subset.motionEntropy) &&
    Number.isInteger(subset.visualClustersUsed) &&
    Number.isInteger(subset.motionClustersUsed) &&
    Array.isArray(subset.visualOccupancy) &&
    subset.visualOccupancy.every(isOccupancy) &&
    Array.isArray(subset.motionOccupancy) &&
    subset.motionOccupancy.every(isOccupancy) &&
    isNullableNumber(subset.medianIdleFraction)
  );
}

function isEpisode(value: unknown): value is Episode {
  if (!value || typeof value !== "object") return false;
  const episode = value as Partial<Episode>;
  return (
    typeof episode.id === "string" &&
    episode.id.length > 0 &&
    (episode.subset === "A" || episode.subset === "B") &&
    typeof episode.lab === "string" &&
    typeof episode.scene === "string" &&
    isFiniteNumber(episode.durationSeconds) &&
    Number.isInteger(episode.visualCluster) &&
    Number.isInteger(episode.motionCluster) &&
    isFiniteNumber(episode.x) &&
    isFiniteNumber(episode.y) &&
    isFiniteNumber(episode.novelty) &&
    isNullableNumber(episode.idleFraction) &&
    typeof episode.preview === "string"
  );
}

export function isComparisonData(value: unknown): value is ComparisonData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ComparisonData>;
  const method = data.method as Partial<ComparisonData["method"]> | undefined;
  const episodes = Array.isArray(data.episodes) && data.episodes.every(isEpisode)
    ? data.episodes
    : [];
  const episodeIds = episodes.map((episode) => episode.id);
  const clusterCount = Number.isInteger(data.clusterCount) ? data.clusterCount as number : 0;
  const countA = episodes.filter((episode) => episode.subset === "A").length;
  const countB = episodes.filter((episode) => episode.subset === "B").length;
  const clustersAreValid = episodes.every(
    (episode) =>
      episode.visualCluster >= 0 &&
      episode.visualCluster < clusterCount &&
      episode.motionCluster >= -1 &&
      episode.motionCluster < clusterCount,
  );

  return (
    data.project === "EgoPrism" &&
    typeof data.source === "string" &&
    typeof data.task === "string" &&
    data.task.length > 0 &&
    typeof data.quality === "string" &&
    (data.winner === "A" || data.winner === "B" || data.winner === "tie") &&
    typeof data.statement === "string" &&
    Array.isArray(data.notes) &&
    data.notes.every((note) => typeof note === "string") &&
    clusterCount > 0 &&
    typeof data.visualOnly === "boolean" &&
    isSubsetSummary(data.subsetA, "A") &&
    isSubsetSummary(data.subsetB, "B") &&
    episodes.length >= 4 &&
    new Set(episodeIds).size === episodeIds.length &&
    countA === data.subsetA?.episodes &&
    countB === data.subsetB?.episodes &&
    data.subsetA.visualOccupancy.length === clusterCount &&
    data.subsetB.visualOccupancy.length === clusterCount &&
    clustersAreValid &&
    Boolean(method) &&
    isFiniteNumber(method?.visualWeight) &&
    isFiniteNumber(method?.motionWeight) &&
    Number.isInteger(method?.bootstrapSamples) &&
    isFiniteNumber(method?.confidenceLevel) &&
    isFiniteNumber(method?.minimumWinnerGap) &&
    isFiniteNumber(method?.idleSpeedThresholdMps)
  );
}
