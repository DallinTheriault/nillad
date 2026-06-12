import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy text → Kokoro neural TTS → audio. Strips markdown so Nillad doesn't read
// "asterisk asterisk" aloud. The dashboard (not the phone) talks to Kokoro, so
// the audio comes back through here.
const TTS = process.env.NILLAD_TTS_URL || "http://host.docker.internal:8880";
const DEFAULT_VOICE = process.env.NILLAD_TTS_VOICE || "af_heart";

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
  let body: { text?: string; voice?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  const text = stripMarkdown(body.text || "").slice(0, 2000);
  if (!text) return new Response("No text", { status: 400 });
  const voice = body.voice || DEFAULT_VOICE;
  try {
    const res = await fetch(`${TTS}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "mp3" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok || !res.body) {
      return Response.json({ error: `TTS engine ${res.status} — is the kokoro container up?` }, { status: 502 });
    }
    return new Response(res.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      { error: `Voice engine unreachable: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
}
