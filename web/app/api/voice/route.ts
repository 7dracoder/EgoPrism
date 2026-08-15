import { loadServerComparison } from "../../data/server-comparison";
import type { ComparisonData } from "../../data/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function briefing(data: ComparisonData): string {
  const winner = data.winner === "tie" ? "Neither subset" : `Subset ${data.winner}`;
  return [
    `EgoPrism compared ${data.subsetA.episodes} episodes in subset A with ${data.subsetB.episodes} episodes in subset B for the ${data.task} task.`,
    `Subset A scored ${data.subsetA.score.toFixed(1)}. Subset B scored ${data.subsetB.score.toFixed(1)}.`,
    `${winner} is the clear result. ${data.statement}`,
    "This is a data coverage signal, not a claim that a higher score guarantees better robot policy performance.",
  ].join(" ");
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "Voice briefing is not configured. Add the server-side ElevenLabs key." },
      { status: 503 },
    );
  }

  const data = await loadServerComparison();
  const voiceId = process.env.EGOPRISM_ELEVEN_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb";
  const modelId = process.env.EGOPRISM_ELEVEN_MODEL_ID?.trim() || "eleven_flash_v2_5";
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  endpoint.searchParams.set("output_format", "mp3_44100_128");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: briefing(data),
        model_id: modelId,
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return Response.json(
        { error: "ElevenLabs could not generate the briefing. Try again shortly." },
        { status: 502 },
      );
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("audio/")) {
      return Response.json(
        { error: "ElevenLabs returned an unexpected response." },
        { status: 502 },
      );
    }
    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "The voice service did not respond in time. Try again shortly." },
      { status: 504 },
    );
  }
}
