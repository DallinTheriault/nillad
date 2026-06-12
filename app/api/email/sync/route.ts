import { NextRequest } from "next/server";
import { syncAllMailboxes } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Pull + triage new mail for every active IMAP mailbox. Meant to be hit on a
// short n8n cron (e.g. every 10 min) and by hand. Key-gated (?key=… or
// X-Sync-Key header) = NF_SESSION_SECRET so a random LAN caller can't drive it.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-sync-key") || "";
  const expected = process.env.NF_SESSION_SECRET || "";
  if (!expected || key !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const results = await syncAllMailboxes();
    return Response.json({ ok: true, mailboxes: results.length, results });
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
