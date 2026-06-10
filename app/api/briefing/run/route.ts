import { NextRequest } from "next/server";
import { buildBriefing } from "@/lib/briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Generate today's morning briefing. Called by the n8n cron (and runnable by hand).
// Gated by a shared key (?key=… or X-Briefing-Key header) = NF_SESSION_SECRET, so a
// random caller can't trigger model work on the local network.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-briefing-key") || "";
  const expected = process.env.NF_SESSION_SECRET || "";
  if (!expected || key !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const { note, markdown } = await buildBriefing();
    return Response.json({ ok: true, note, length: markdown.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return run(req);
}
export async function POST(req: NextRequest): Promise<Response> {
  return run(req);
}
