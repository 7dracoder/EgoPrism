export const voiceAnswers = {
  overview:
    "EgoPrism compares two task-matched robot dataset slices and measures how broadly each one covers visual contexts and motion patterns. The initial fold-clothes dashboard contains a 12,000-row deterministic interface index, with 6,000 rows per subset, expanded from 16 scored source episodes with clear 640 by 480 frames. It selects Subset B. Voice, captions, metadata counts, and language models never affect the score.",
  winner:
    "Subset B wins with a score of 82.8 versus 37.5 for Subset A, a gap of about 45.3 points. Both subsets reach three of four visual clusters, but B reaches all four motion clusters while A occupies only one. The source-episode confidence intervals separate, so the conservative winner rule is satisfied.",
  score:
    "EgoPrism standardizes visual and motion features on the pooled A plus B set, clusters each feature family, and computes normalized cluster entropy. The score is 50 times visual entropy plus 50 times motion entropy, producing a value from zero to one hundred. The current comparison uses four clusters.",
  confidence:
    "EgoPrism resamples whole episodes 200 times to form 95 percent bootstrap confidence intervals. It declares a winner only when the intervals do not overlap and the score gap is at least two points. Otherwise it reports no clear difference.",
  evidence:
    "The fixed cockpit has four evidence panels. For performance, the visual projection shows a deterministic stratified sample of 320 from all 12,000 episode records: outlined squares are A, teal circles are B, and the numeral is its visual cluster. Nearby marks have more similar image fingerprints, but screen distance is not the score. The cluster and score panels use the complete dataset. The episode inspector connects a selected point to its frame and metrics. Uploaded comparison JSON replaces all four panels without using a language model to score anything.",
  visual:
    "The visual signal samples eight front-camera frames per episode. It uses stored DINO vectors when available, L2-normalizes and mean-pools them, then compares cluster coverage across the pooled subsets. In the current source comparison, both subsets occupy three of four visual clusters; the larger difference comes from motion coverage.",
  motion:
    "The motion signal summarizes hand paths, speed, idle fraction, bimanual coordination, and available head motion. The idle speed threshold is 0.02 meters per second, and poses are rewritten into the current head frame when head pose exists. Subset B covers all four current motion clusters, while Subset A occupies one.",
  limitations:
    "A higher EgoPrism score means broader measured cluster coverage; it does not guarantee better robot policy performance. The initial source comparison contains only 16 extracted episodes. The 12,000 dashboard rows repeat their scored summaries for interface-scale testing and are not 12,000 additional recordings, so the source sample remains too small for a broad scientific claim.",
  fixtures:
    "The current dashboard is backed by 16 extracted fold-clothes source episodes, eight per subset, with clear 640 by 480 representative frames. It deterministically expands their summaries into 12,000 interface rows so charts, search, and selection can be tested at scale. Those repeated rows are not additional recordings, and confidence intervals remain tied to the 16 scored source episodes.",
  architecture:
    "The scoring pipeline lives in Python, while Modal serves a read-only summary API. The Hallmark dashboard is a Next.js application deployed on Vercel from the web directory of the GitHub repository. It uses a deterministic bundled fallback with the same extracted episode frames if Modal is temporarily unavailable, and ElevenLabs speech is called only from server routes.",
  track:
    "EgoPrism is the Track 2 quantitative diversity measurement project. Its core claim is that, for a matched task and dataset size, one slice can cover more distinct visual contexts and manipulation patterns than another. It is a data-selection signal, not a downstream policy evaluation.",
  dashboard:
    "The Hallmark Cobalt dashboard is a fixed single-screen workbench with no page-level vertical scrolling. Desktop shows four panels at once: visual projection, visual and motion cluster coverage, score anatomy with confidence intervals, and an episode inspector. Smaller screens use four tabs while staying within the viewport. Dataset details and validated JSON upload open from the right, while the continuous ElevenLabs assistant uses a compact answer-only bubble.",
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
