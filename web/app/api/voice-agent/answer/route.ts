import { classifyVoiceQuestion, voiceAnswers } from "../knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSameSiteRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "same-site";
}

export async function POST(request: Request) {
  if (!isSameSiteRequest(request)) {
    return Response.json({ error: "Questions must be sent from EgoPrism." }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as { question?: unknown };
    const question = typeof payload.question === "string" ? payload.question.trim() : "";
    if (!question || question.length > 240) {
      return Response.json({ error: "Ask a question between 1 and 240 characters." }, { status: 400 });
    }

    const topic = classifyVoiceQuestion(question);
    return Response.json(
      { topic, answer: voiceAnswers[topic] },
      { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch {
    return Response.json({ error: "The question could not be read." }, { status: 400 });
  }
}
