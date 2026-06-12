import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 70;

// Proxy a command to the host shell agent (which runs PowerShell on the Windows
// machine). Authed by session here; the agent is additionally gated by a shared
// token (NF_SESSION_SECRET). If the agent isn't running, return a clear hint.
const AGENT = process.env.NILLAD_SHELL_AGENT_URL || "http://host.docker.internal:7717";
const TOKEN = process.env.NF_SESSION_SECRET || "";

export async function POST(req: NextRequest): Promise<Response> {
  if (!(await isAuthed())) return Response.json({ error: "Unauthorized." }, { status: 401 });
  let body: { cmd?: string; cwd?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad body." }, { status: 400 });
  }
  if (!body.cmd || !body.cmd.trim()) return Response.json({ error: "No command." }, { status: 400 });
  try {
    const r = await fetch(`${AGENT}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, cmd: body.cmd, cwd: body.cwd }),
      signal: AbortSignal.timeout(65000),
    });
    if (!r.ok) {
      if (r.status === 401) return Response.json({ error: "Shell agent rejected the token (restart it after changing NF_SESSION_SECRET)." }, { status: 502 });
      return Response.json({ error: `Shell agent error ${r.status}.` }, { status: 502 });
    }
    return Response.json(await r.json());
  } catch (e) {
    return Response.json(
      {
        error:
          "Host shell agent isn't reachable. Start it on the PC: `node C:\\Projects\\nillad-workspace\\host-shell-agent.cjs` (or re-run the Nillad launcher).",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
