import type { ComparisonData } from "../../data/types";

export const voiceTopics = {
  overview: true,
  winner: true,
  score: true,
  confidence: true,
  evidence: true,
  visual: true,
  motion: true,
  limitations: true,
  fixtures: true,
  architecture: true,
  track: true,
  dashboard: true,
} as const;

export type VoiceTopic = keyof typeof voiceTopics;

const count = (value: number) => value.toLocaleString("en-US");

export function voiceAnswer(topic: VoiceTopic, data: ComparisonData): string {
  const total = data.episodes.length;
  const sources = new Set(data.episodes.map((episode) => episode.source).filter(Boolean)).size;
  const winner = data.winner === "tie" ? "Neither subset has a clear lead" : `Subset ${data.winner} wins`;
  const gap = Math.abs(data.subsetB.score - data.subsetA.score);

  const answers: Record<VoiceTopic, string> = {
    overview:
      `EgoPrism compares ${count(data.subsetA.episodes)} single-source Scale episodes with ${count(data.subsetB.episodes)} multi-source Aria, Eva, and Scale episodes. The task-family quotas are identical and duration is matched. It measures visual and motion coverage, and ${winner.toLowerCase()}. Voice, captions, metadata labels, and language models never affect the score.`,
    winner:
      `${winner}. Subset A scores ${data.subsetA.score.toFixed(1)} and Subset B scores ${data.subsetB.score.toFixed(1)}, a ${gap.toFixed(1)} point gap. EgoPrism only calls a winner when the 95 percent confidence intervals do not overlap and the gap is at least ${data.method.minimumWinnerGap.toFixed(0)} points.`,
    score:
      `EgoPrism standardizes pooled visual and motion features, clusters each feature family into ${data.clusterCount} groups, and computes normalized cluster entropy. The score is ${Math.round(data.method.visualWeight * 100)} percent visual entropy plus ${Math.round(data.method.motionWeight * 100)} percent motion entropy, scaled from zero to one hundred.`,
    confidence:
      `EgoPrism resamples whole episodes ${data.method.bootstrapSamples} times to form ${Math.round(data.method.confidenceLevel * 100)} percent bootstrap confidence intervals. It declares a winner only when those intervals do not overlap and the score gap is at least ${data.method.minimumWinnerGap.toFixed(0)} points.`,
    evidence:
      `The fixed cockpit has four evidence panels. The visual projection shows a deterministic stratified sample of up to 320 from all ${count(total)} episodes; nearby marks have more similar visual fingerprints, but screen distance is not the score. Coverage and score panels use the complete dataset, and the inspector retrieves the selected episode's real 640 by 480 frame from EgoVerse through Modal.`,
    visual:
      `The production run samples eight real front-camera frames per episode and builds a normalized color-and-spatial grid fingerprint before pooled clustering. Subset A occupies ${data.subsetA.visualClustersUsed} of ${data.clusterCount} visual clusters and Subset B occupies ${data.subsetB.visualClustersUsed} of ${data.clusterCount}.`,
    motion:
      `The motion signal summarizes hand path length, speed, idle fraction, bimanual coordination, and available head motion. The idle threshold is ${data.method.idleSpeedThresholdMps.toFixed(2)} meters per second. Subset A occupies ${data.subsetA.motionClustersUsed} motion clusters and Subset B occupies ${data.subsetB.motionClustersUsed}.`,
    limitations:
      `A higher EgoPrism score means broader measured cluster coverage; it does not guarantee better robot policy performance. This run does use ${count(total)} independent production episodes, but its color-and-spatial visual fingerprint is a lightweight screening signal rather than a semantic foundation model embedding.`,
    fixtures:
      `The live dashboard uses ${count(total)} independent production Zarr episodes from ${sources || 3} EgoVerse sources. The rows are not repeated or expanded. Subset A is a 6,000-episode Scale baseline; subset B is a 6,000-episode Aria, Eva, and Scale slice. Their five task-family quotas are identical and total duration differs by less than five percent.`,
    architecture:
      `Modal inventories and extracts the private EgoVerse R2 data, stores the compact feature cache, serves the scored summary, and retrieves real episode frames on demand. The Hallmark-style Next.js cockpit is deployed on Vercel, and ElevenLabs speech is called only from protected server routes.`,
    track:
      `EgoPrism is the Track 2 quantitative diversity measurement project. It compares task-family and duration-matched dataset slices using visual and motion coverage. The result is a data-selection signal, not a downstream policy evaluation.`,
    dashboard:
      `The Hallmark Cobalt dashboard is a fixed single-screen workbench. Desktop shows visual projection, cluster coverage, score confidence, and the episode inspector together. Dataset details open from the side, and the continuous ElevenLabs assistant keeps only its answer transcript in the compact bubble until End conversation is pressed.`,
  };
  return answers[topic];
}

const containsAny = (question: string, terms: string[]) =>
  terms.some((term) => question.includes(term));

export function classifyVoiceQuestion(question: string): VoiceTopic {
  const normalized = question.toLowerCase();

  if (containsAny(normalized, ["limit", "prove", "guarantee", "policy", "better robot", "claim"])) return "limitations";
  if (containsAny(normalized, ["synthetic", "fixture", "real data", "egodb", "dataset valid", "data valid", "valid dataset"])) return "fixtures";
  if (containsAny(normalized, ["why did", "winner", "who won", "subset b win", "which subset"])) return "winner";
  if (containsAny(normalized, ["confidence", "bootstrap", "interval", "uncertainty", "clear difference"])) return "confidence";
  if (containsAny(normalized, ["formula", "calculate", "calculated", "score", "entropy", "weight"])) return "score";
  if (containsAny(normalized, ["read the chart", "read chart", "read the plot", "read plot", "visualization", "visualisation", "occupancy"])) return "evidence";
  if (containsAny(normalized, ["visual", "dino", "frame", "image", "pixel"])) return "visual";
  if (containsAny(normalized, ["motion", "idle", "hand", "head", "pose", "speed"])) return "motion";
  if (containsAny(normalized, ["evidence", "projection", "cluster", "episode", "occupancy"])) return "evidence";
  if (containsAny(normalized, ["architecture", "modal", "vercel", "github", "api", "deploy"])) return "architecture";
  if (containsAny(normalized, ["hallmark", "dashboard", "design", "interface", "responsive"])) return "dashboard";
  if (containsAny(normalized, ["track", "hackathon", "competition"])) return "track";
  return "overview";
}
