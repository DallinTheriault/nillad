import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { scanReceipt } from "@/lib/expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Run the vision model on a receipt photo and return the parsed fields. A route
// handler (not a server action) so the image data URL isn't capped at 1MB.
export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let body: { dataUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad body." }, { status: 400 });
  }
  if (!body.dataUrl) return Response.json({ error: "Missing image." }, { status: 400 });
  try {
    const parsed = await scanReceipt(body.dataUrl);
    return Response.json({ ok: true, parsed });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Scan failed." }, { status: 500 });
  }
}
