import { NextRequest } from "next/server";
import { runAgentStream, agentConfigured, type ChatMsg } from "@/lib/agent";
import { DEFAULT_TOOLS } from "@/lib/nillad-tools";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Middleware only checks cookie *presence* (it can't use better-sqlite3 / crypto
  // in the edge runtime). Verify the signed session HMAC here before doing any
  // work, so a forged/expired cookie can't reach the model or the tools.
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!agentConfigured()) {
    return Response.json(
      { error: "Nillad chat isn’t configured. Set NILLAD_OLLAMA_MODEL / OLLAMA_BASE_URL." },
      { status: 503 },
    );
  }

  let messages: ChatMsg[] = [];
  let tools: string[] = DEFAULT_TOOLS;
  let think = false;
  try {
    const body = (await req.json()) as {
      messages?: ChatMsg[];
      tools?: string[];
      think?: boolean;
    };
    messages = Array.isArray(body.messages) ? body.messages : [];
    // Optional per-context tool scoping (e.g. Messages thread → [send_sms, jobs_contacts]).
    if (Array.isArray(body.tools) && body.tools.length) tools = body.tools;
    // "Think harder" — let the model reason before answering (slower, deeper).
    think = body.think === true;
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "No messages." }, { status: 400 });
  }

  // The agent runs the native function-calling loop dashboard-side (executing
  // tools against nillad.db / n8n) and streams the final reply as OpenAI-style
  // SSE — the same shape the OWUI pass-through used, so the client is unchanged.
  const stream = runAgentStream(messages, tools, think);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
