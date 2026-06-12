import { NextRequest } from "next/server";
import { evaluateAutomations } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Evaluate proactive automations and draft any actions that need Dallin's approval.
// Called by the n8n cron (nilautomationcron01) + runnable by hand. Drafts only —
// nothing is sent here. Gated by a shared key (?key=… or X-Automation-Key) =
// NF_SESSION_SECRET.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-automation-key") || "";
  const expected = process.env.NF_SESSION_SECRET || "";
  if (!expected || key !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await evaluateAutomations();
    return Response.json({ ok: true, ...result });
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
