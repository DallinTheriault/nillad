import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { readPhoto } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve a gallery image from the vault Photos/ dir. Uses a ?name= query (NOT a
// .jpg path) so it does NOT match middleware's static-image allowlist — every
// fetch goes through auth. Double-checked with isAuthed() here too.
export async function GET(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
  const name = new URL(req.url).searchParams.get("name") || "";
  const photo = readPhoto(name);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.buf), {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=60" },
  });
}
