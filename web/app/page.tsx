import Dashboard from "./dashboard";
import fallbackData from "./data/fallback.json";
import type { ComparisonData } from "./data/types";

export const dynamic = "force-dynamic";

function isComparisonData(value: unknown): value is ComparisonData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ComparisonData>;
  return (
    data.project === "EgoPrism" &&
    (data.winner === "A" || data.winner === "B" || data.winner === "tie") &&
    Array.isArray(data.episodes) &&
    typeof data.subsetA?.score === "number" &&
    typeof data.subsetB?.score === "number"
  );
}

async function loadComparison(): Promise<ComparisonData> {
  const fallback = fallbackData as unknown as ComparisonData;
  const endpoint = process.env.MODAL_API_URL?.trim();
  if (!endpoint) return fallback;

  try {
    const response = await fetch(endpoint, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return fallback;
    const payload: unknown = await response.json();
    return isComparisonData(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}

export default async function Page() {
  return <Dashboard data={await loadComparison()} />;
}
