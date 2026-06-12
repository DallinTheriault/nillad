import { NextRequest } from "next/server";
import { buildEveningReview } from "@/lib/evening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Generate the evening review. Called by an n8n cron (~5:30pm) and runnable by
// hand. Key-gated (?key=… or X-Briefing-Key header) = NF_SESSION_SECRET.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-briefing-key") || "";
  const expected = process.env.NF_SESSION_SECRET || "";
  if (!expected || key !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const { note, markdown } = await buildEveningReview();
    return Response.json({ ok: true, note, length: markdown.length });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return run(req);
}
export async function POST(req: NextRequest): Promise<Response> {
  return run(req);
}
