import { loadServerComparison } from "../../../data/server-comparison";
import { voiceAnswer, voiceTopics, type VoiceTopic } from "../knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isVoiceTopic(value: string): value is VoiceTopic {
  return Object.hasOwn(voiceTopics, value);
}

export async function GET(request: Request) {
  const topicValue = new URL(request.url).searchParams.get("topic") || "";
  if (!isVoiceTopic(topicValue)) {
    return Response.json({ error: "Unknown EgoPrism answer topic." }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "ElevenLabs speech is not configured." }, { status: 503 });
  }

  const voiceId = process.env.EGOPRISM_ELEVEN_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb";
  const modelId = process.env.EGOPRISM_ELEVEN_MODEL_ID?.trim() || "eleven_flash_v2_5";
  const endpoint = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  endpoint.searchParams.set("output_format", "mp3_44100_128");
  const answer = voiceAnswer(topicValue, await loadServerComparison());

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text: answer,
        model_id: modelId,
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("audio/")) {
      return Response.json({ error: "ElevenLabs could not speak this answer." }, { status: 502 });
    }

    return new Response(await response.arrayBuffer(), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "ElevenLabs did not respond in time." }, { status: 504 });
  }
}
