import { NextRequest } from "next/server";
import { runBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Take a nightly snapshot of nillad.db. Called by the n8n cron (nilbackupcron01)
// and runnable by hand. Gated by a shared key (?key=… or X-Backup-Key header) =
// NF_SESSION_SECRET, so a random caller on the LAN can't trigger it.
async function run(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-backup-key") || "";
  const expected = process.env.NF_SESSION_SECRET || "";
  if (!expected || key !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await runBackup();
    return Response.json(result);
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
