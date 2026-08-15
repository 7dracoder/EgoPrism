export const voiceAnswers = {
  overview:
    "EgoPrism compares two task-matched robot dataset slices and measures how broadly each one covers visual contexts and motion patterns. The current fold-clothes demonstration compares 16 episodes per subset and selects Subset B. Voice, captions, metadata counts, and language models never affect the score.",
  winner:
    "Subset B wins with a score of 77.1 versus 17.5 for Subset A, a gap of about 59.6 points. B reaches all five visual clusters and shows more varied manipulation motion, while A occupies one visual cluster and has more idle behavior. The confidence intervals separate, so the conservative winner rule is satisfied.",
  score:
    "EgoPrism standardizes visual and motion features on the pooled A plus B set, clusters each feature family, and computes normalized cluster entropy. The score is 50 times visual entropy plus 50 times motion entropy, producing a value from zero to one hundred. The current comparison uses five clusters.",
  confidence:
    "EgoPrism resamples whole episodes 200 times to form 95 percent bootstrap confidence intervals. It declares a winner only when the intervals do not overlap and the score gap is at least two points. Otherwise it reports no clear difference.",
  evidence:
    "The fixed cockpit has four evidence panels. The visual projection maps one episode per mark: outlined squares are A, teal circles are B, and the numeral is its visual cluster. Nearby marks have more similar image fingerprints, but screen distance is not the score. The cluster panel compares visual and motion occupancy with an upper A bar and lower B bar. The score panel shows visual and motion entropy plus bootstrap intervals. The episode inspector connects a selected point to its frame and metrics. Uploaded comparison JSON replaces all four panels without using a language model to score anything.",
  visual:
    "The visual signal samples eight front-camera frames per episode. It uses stored DINO vectors when available, L2-normalizes and mean-pools them, then compares cluster coverage across the pooled subsets. Subset B covers five visual clusters in the current demonstration, while A covers one.",
  motion:
    "The motion signal summarizes hand paths, speed, idle fraction, bimanual coordination, and available head motion. The idle speed threshold is 0.02 meters per second, and poses are rewritten into the current head frame when head pose exists. Subset B shows broader motion coverage and less idle behavior in this demonstration.",
  limitations:
    "A higher EgoPrism score means broader measured cluster coverage; it does not guarantee better robot policy performance. The included episodes are synthetic schema-faithful fixtures, so they support a reproducible product demonstration rather than a final scientific EgoVerse claim. An approved real data slice is still needed for that claim.",
  fixtures:
    "The current dataset is valid for an end-to-end product and method demonstration, but not for a scientific claim about real EgoVerse recordings. The repository ships 32 deterministic, synthetic schema-faithful episodes so the pipeline can run without private EgoDB access. They preserve the expected image, embedding, pose, and metadata structure. Replace the manifests and zarr stores with an approved real slice before presenting the result as research evidence.",
  architecture:
    "The scoring pipeline and fixtures live in Python, while Modal serves a read-only summary API. The Hallmark dashboard is a Next.js application deployed on Vercel from the web directory of the GitHub repository. It uses a deterministic bundled fallback if Modal is temporarily unavailable, and ElevenLabs speech is called only from server routes.",
  track:
    "EgoPrism is the Track 2 quantitative diversity measurement project. Its core claim is that, for a matched task and dataset size, one slice can cover more distinct visual contexts and manipulation patterns than another. It is a data-selection signal, not a downstream policy evaluation.",
  dashboard:
    "The Hallmark Cobalt dashboard is a fixed single-screen workbench with no page-level vertical scrolling. Desktop shows four panels at once: visual projection, visual and motion cluster coverage, score anatomy with confidence intervals, and an episode inspector. Smaller screens use four tabs while staying within the viewport. Dataset details and validated JSON upload open from the right, and the continuous ElevenLabs assistant uses a separate side drawer.",
} as const;

export type VoiceTopic = keyof typeof voiceAnswers;

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
