// Passive memory capture: after a chat turn, if the message carries a high-signal
// cue (a preference, decision, stable fact, or explicit "remember…"), ask the
// local model to distill ONE durable line and file it into the vault — deduped,
// secret-skipping — so Dallin doesn't have to say "remember this" every time.
// Conservative by design: the gate keeps the extraction call rare, and it only
// writes when there's something clearly worth keeping.

import { appendNote, noteRaw } from "@/lib/vault";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const AUTO_NOTE = "Memory/Nillad Auto-Notes.md";

// High-signal cues only — chit-chat and questions don't trip this.
const GATE =
  /\b(remember|note that|don'?t forget|keep in mind|for the record|make a note|i prefer|i always|i never|i (really )?(hate|love)|i decided|we decided|i'?m going with|i chose|my [a-z]+ (is|are|was|costs?|number|name))\b/i;

export function gateAutoMemory(userText: string): boolean {
  return !!userText && userText.length < 2000 && GATE.test(userText);
}

async function extract(userText: string, assistantText: string): Promise<string> {
  const system =
    "From the latest exchange, extract AT MOST ONE durable fact worth remembering long-term about Dallin — a preference, a decision, a stable personal/business fact, or a commitment. Reply with a single concise line in the form 'Subject: fact' (e.g. 'Audi S6: due for an oil change in ~500 miles'). If nothing durable is worth keeping (small talk, a question, a transient task already handled), reply with exactly: NONE. Never record passwords, secrets, or keys.";
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Dallin: ${userText}\nNillad: ${assistantText}`.slice(0, 2000) },
        ],
        think: false,
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    return (j.message?.content || "").trim();
  } catch {
    return "NONE";
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export async function autoCapture(userText: string, assistantText: string): Promise<void> {
  const line = (await extract(userText, assistantText)).split("\n")[0].trim();
  if (!line || /^none\b/i.test(line) || line.length < 6) return;
  if (/\b(password|secret|api[\s-]?key|token|encryption key)\b/i.test(line)) return;

  // Crude dedup against the running auto-notes file.
  const existing = noteRaw(AUTO_NOTE);
  if (existing) {
    const ex = norm(existing);
    const key = norm(line);
    if (ex.includes(key) || (key.length > 24 && ex.includes(key.slice(0, 24)))) return;
  }
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
  appendNote(AUTO_NOTE, `- [${stamp}] ${line}`);
}
