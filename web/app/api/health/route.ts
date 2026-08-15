import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
    modalConfigured: Boolean(process.env.MODAL_API_URL?.trim()),
  });
}
