import Dashboard from "./dashboard";
import fallbackData from "./data/fallback.json";
import type { ComparisonData } from "./data/types";
import { isComparisonData } from "./data/validate";

export const dynamic = "force-dynamic";

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
