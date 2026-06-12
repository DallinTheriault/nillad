import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { savePhotoDataUrl } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Receive a (client-downscaled) image as a data URL and save it to the gallery.
// A route handler — not a server action — so large-ish photos aren't blocked by
// the 1MB server-action body cap. `overwrite` is used when saving an edit back
// onto the same file. Auth-gated.
export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let body: { name?: string; dataUrl?: string; overwrite?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad body." }, { status: 400 });
  }
  if (!body.dataUrl) return Response.json({ error: "Missing image." }, { status: 400 });
  try {
    const filename = savePhotoDataUrl(body.name || "photo.jpg", body.dataUrl, !!body.overwrite);
    // Ensure a metadata row exists (no-op if already there).
    getDb()
      .prepare(`INSERT OR IGNORE INTO photos (filename) VALUES (?)`)
      .run(filename);
    return Response.json({ ok: true, name: filename });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Save failed." }, { status: 500 });
  }
}
