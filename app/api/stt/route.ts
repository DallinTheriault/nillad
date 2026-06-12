import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Speech-to-text: the browser uploads recorded mic audio (MediaRecorder blob),
// we forward it to the local Whisper container and return the transcript. Browser-
// independent — works on iOS Safari / Arc where the Web Speech API doesn't exist.
const STT = process.env.NILLAD_STT_URL || "http://host.docker.internal:9000";

export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return Response.json({ error: "No audio." }, { status: 400 });
    const type = req.headers.get("content-type") || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";

    const form = new FormData();
    form.append("audio_file", new Blob([buf], { type }), `clip.${ext}`);

    const res = await fetch(`${STT}/asr?task=transcribe&language=en&output=txt&encode=true`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      return Response.json({ error: `STT engine ${res.status} — is the whisper container up?` }, { status: 502 });
    }
    const text = (await res.text()).trim();
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json(
      { error: `Transcription failed: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
}
