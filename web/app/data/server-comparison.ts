import "server-only";

import fallbackData from "./fallback.json";
import type { ComparisonData } from "./types";
import { isComparisonData } from "./validate";

export async function loadServerComparison(): Promise<ComparisonData> {
  const fallback = fallbackData as unknown as ComparisonData;
  const endpoint = process.env.MODAL_API_URL?.trim();
  if (!endpoint) return fallback;

  try {
    const url = new URL(endpoint);
    url.searchParams.set("dataset", "real-12000-v1");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback;
    const payload: unknown = await response.json();
    return isComparisonData(payload) ? payload : fallback;
  } catch {
    return fallback;
  }
}
