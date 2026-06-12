// Proactive automations — the step where Nillad ACTS instead of just surfacing.
// A daily evaluator detects situations that need Dallin to reach out (an invoice
// unpaid past a threshold, a lead/quote gone quiet) and DRAFTS the message for
// each — then parks it in pending_actions for his one-tap approval. It NEVER sends
// on its own (his hard rule: no auto-texting). Approving sends via the existing
// n8n→Twilio path and records the outbound into his Messages threads.

import { getDb } from "@/lib/db";
import { sendSmsViaN8n } from "@/lib/n8n";
import { businessFor } from "@/lib/jobs";
import { pushNtfy } from "@/lib/notify";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const TOPIC = process.env.NILLAD_AUTOMATION_TOPIC || "nillad-actions";

// Thresholds (days). Conservative so Nillad nudges, not nags.
const INVOICE_NUDGE_DAYS = Number(process.env.NILLAD_INVOICE_NUDGE_DAYS || 7);
const LEAD_FOLLOWUP_DAYS = Number(process.env.NILLAD_LEAD_FOLLOWUP_DAYS || 3);
const REDRAFT_COOLDOWN_DAYS = 7; // don't re-draft the same ref within this window

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
function q<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export type PendingAction = {
  id: number;
  kind: string;
  status: string;
  title: string;
  detail: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  draft_body: string | null;
  ref_type: string | null;
  ref_id: number | null;
  dedupe_key: string | null;
  created_at: string;
  decided_at: string | null;
};

// Has this exact situation already been drafted (pending) or actioned recently?
// Keeps the evaluator idempotent across runs and prevents nagging.
function recentlyHandled(dedupeKey: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM pending_actions
       WHERE dedupe_key = ?
         AND (status = 'pending'
              OR (decided_at IS NOT NULL AND datetime(decided_at) > datetime('now', ?)))
       LIMIT 1`,
    )
    .get(dedupeKey, `-${REDRAFT_COOLDOWN_DAYS} days`);
  return !!row;
}

// Draft a short, friendly SMS for a situation. gemma writes it; a plain template is
// the fallback so a model hiccup never blocks the draft. Always returns ≤ ~320 chars.
async function draftMessage(system: string, context: string, fallback: string): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: false,
        options: { temperature: 0.6 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: context },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    const out = (j.message?.content || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
    return out && out.length <= 400 ? out : out ? out.slice(0, 320) : fallback;
  } catch {
    return fallback;
  }
}

const SMS_SYSTEM =
  "You write a SHORT, warm, professional SMS that Dallin (a contractor/painter, owner of his business) would send to a client. One message, 1-3 sentences, plain text (no markdown, no placeholders, no signature line beyond his first name 'Dallin' if natural). Friendly and low-pressure, never pushy or threatening. Output ONLY the message text.";

export type EvalResult = { created: number; items: { kind: string; title: string }[] };

export async function evaluateAutomations(): Promise<EvalResult> {
  const db = getDb();
  const created: { kind: string; title: string }[] = [];

  const insert = db.prepare(
    `INSERT INTO pending_actions
       (kind, title, detail, recipient_name, recipient_phone, draft_body, ref_type, ref_id, dedupe_key)
     VALUES (@kind, @title, @detail, @recipient_name, @recipient_phone, @draft_body, @ref_type, @ref_id, @dedupe_key)`,
  );

  // ---- Rule 1: invoice unpaid past the threshold → draft a payment nudge ----
  const staleInvoices = q(
    () =>
      db
        .prepare(
          `SELECT i.id AS invoice_id, i.number, i.total, i.sent_at, i.biller,
                  COALESCE(j.title, j.client, 'your project') AS job,
                  c.name AS contact_name, c.phone AS contact_phone
           FROM invoices i
           LEFT JOIN jobs j ON j.id = i.job_id
           LEFT JOIN contacts c ON c.id = j.contact_id
           WHERE i.status = 'sent' AND i.sent_at IS NOT NULL
             AND datetime(i.sent_at) <= datetime('now', ?)
           ORDER BY i.sent_at ASC LIMIT 25`,
        )
        .all(`-${INVOICE_NUDGE_DAYS} days`) as Array<{
        invoice_id: number;
        number: string;
        total: number;
        sent_at: string;
        biller: string | null;
        job: string;
        contact_name: string | null;
        contact_phone: string | null;
      }>,
    [],
  );

  for (const inv of staleInvoices) {
    if (!inv.contact_phone) continue; // can't draft a text with no number
    const dedupe = `invoice_nudge:${inv.number}`;
    if (recentlyHandled(dedupe)) continue;
    const days = Math.floor((Date.now() - Date.parse(inv.sent_at)) / 86400000);
    const biz = businessFor(inv.biller);
    const fallback = `Hi${inv.contact_name ? ` ${inv.contact_name.split(" ")[0]}` : ""}, just a friendly reminder that invoice ${inv.number} for ${inv.job} (${money(inv.total)}) is still open. Let me know if you have any questions — thanks! — Dallin, ${biz.name}`;
    const body = await draftMessage(
      SMS_SYSTEM,
      `Write a gentle payment reminder. Business: ${biz.name}. Client: ${inv.contact_name || "the client"}. Invoice ${inv.number} for "${inv.job}", amount ${money(inv.total)}, sent ${days} days ago, still unpaid. Keep it light and friendly.`,
      fallback,
    );
    insert.run({
      kind: "invoice_nudge",
      title: `Nudge ${inv.contact_name || "client"} — ${inv.number} unpaid ${days}d`,
      detail: `${money(inv.total)} for ${inv.job} · sent ${inv.sent_at.slice(0, 10)}`,
      recipient_name: inv.contact_name,
      recipient_phone: inv.contact_phone,
      draft_body: body,
      ref_type: "invoice",
      ref_id: inv.invoice_id,
      dedupe_key: dedupe,
    });
    created.push({ kind: "invoice_nudge", title: `${inv.number} payment nudge` });
  }

  // ---- Rule 2: lead/quote gone quiet → draft a follow-up ----
  const quietLeads = q(
    () =>
      db
        .prepare(
          `SELECT j.id AS job_id, COALESCE(j.title, j.client, 'your project') AS job, j.status,
                  j.updated_at, j.scope,
                  c.name AS contact_name, c.phone AS contact_phone
           FROM jobs j
           LEFT JOIN contacts c ON c.id = j.contact_id
           WHERE COALESCE(j.status,'lead') IN ('lead','quoted')
             AND COALESCE(j.paid,0) = 0
             AND datetime(COALESCE(j.updated_at, j.created_at)) <= datetime('now', ?)
           ORDER BY j.updated_at ASC LIMIT 25`,
        )
        .all(`-${LEAD_FOLLOWUP_DAYS} days`) as Array<{
        job_id: number;
        job: string;
        status: string;
        updated_at: string | null;
        scope: string | null;
        contact_name: string | null;
        contact_phone: string | null;
      }>,
    [],
  );

  for (const lead of quietLeads) {
    if (!lead.contact_phone) continue;
    const dedupe = `lead_follow_up:${lead.job_id}`;
    if (recentlyHandled(dedupe)) continue;
    const days = lead.updated_at ? Math.floor((Date.now() - Date.parse(lead.updated_at)) / 86400000) : LEAD_FOLLOWUP_DAYS;
    const quoted = lead.status === "quoted";
    const fallback = quoted
      ? `Hi${lead.contact_name ? ` ${lead.contact_name.split(" ")[0]}` : ""}, just following up on the quote I sent for ${lead.job}. Happy to answer any questions or adjust anything — let me know if you'd like to move forward. Thanks! — Dallin`
      : `Hi${lead.contact_name ? ` ${lead.contact_name.split(" ")[0]}` : ""}, checking in about ${lead.job}. Still happy to help whenever you're ready — just let me know. Thanks! — Dallin`;
    const body = await draftMessage(
      SMS_SYSTEM,
      `Write a low-pressure follow-up. Client: ${lead.contact_name || "the client"}. ${quoted ? `You already sent a quote for "${lead.job}"` : `This is an early lead for "${lead.job}"`}${lead.scope ? ` (scope: ${lead.scope.slice(0, 80)})` : ""}. It's been ${days} days with no movement. Nudge them gently to keep it alive.`,
      fallback,
    );
    insert.run({
      kind: "lead_follow_up",
      title: `Follow up ${lead.contact_name || "lead"} — ${lead.job} quiet ${days}d`,
      detail: `${quoted ? "Quote sent" : "Lead"} · no movement since ${(lead.updated_at || "").slice(0, 10) || "a while"}`,
      recipient_name: lead.contact_name,
      recipient_phone: lead.contact_phone,
      draft_body: body,
      ref_type: "job",
      ref_id: lead.job_id,
      dedupe_key: dedupe,
    });
    created.push({ kind: "lead_follow_up", title: `${lead.job} follow-up` });
  }

  if (created.length) {
    await pushNtfy(
      TOPIC,
      `Nillad drafted ${created.length} message${created.length > 1 ? "s" : ""}`,
      created.map((c) => `• ${c.title}`).join("\n") + "\n\nReview & send in Approvals.",
      { priority: 4, tags: "memo" },
    );
  }

  return { created: created.length, items: created };
}

// ---------- Reads / mutations for the Approvals UI ----------

export function listPendingActions(): PendingAction[] {
  return getDb()
    .prepare(`SELECT * FROM pending_actions WHERE status='pending' ORDER BY created_at DESC`)
    .all() as PendingAction[];
}

export function pendingCount(): number {
  return q(
    () => (getDb().prepare(`SELECT COUNT(*) AS n FROM pending_actions WHERE status='pending'`).get() as { n: number }).n,
    0,
  );
}

export function getAction(id: number): PendingAction | undefined {
  return getDb().prepare(`SELECT * FROM pending_actions WHERE id=?`).get(id) as PendingAction | undefined;
}

export function dismissAction(id: number): void {
  getDb()
    .prepare(`UPDATE pending_actions SET status='dismissed', decided_at=datetime('now') WHERE id=? AND status='pending'`)
    .run(id);
}

// Record an outbound text into the Messages threads (same path the chat tool uses).
function recordOutbound(to: string, body: string, sid: string | null, status: string | null): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO sms_threads (contact_phone, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
  ).run(to);
  const thread = db.prepare(`SELECT id FROM sms_threads WHERE contact_phone = ?`).get(to) as { id: number } | undefined;
  if (!thread) return;
  db.prepare(
    `INSERT INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
     VALUES (?, 'outbound', ?, ?, ?, datetime('now'))`,
  ).run(thread.id, body, sid ?? null, status ?? "queued");
}

// Approve a drafted action: send the (possibly edited) text, record it, mark sent.
// For a lead follow-up, touch the job so it isn't immediately re-flagged as quiet.
export async function approveAction(id: number, overrideBody?: string): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const a = getAction(id);
  if (!a) return { ok: false, message: "That action no longer exists." };
  if (a.status !== "pending") return { ok: false, message: "Already handled." };
  const phone = a.recipient_phone;
  const body = (overrideBody && overrideBody.trim()) || a.draft_body || "";
  if (!phone) return { ok: false, message: "No phone number on this action." };
  if (!body) return { ok: false, message: "The draft is empty." };

  const res = await sendSmsViaN8n(phone, body);
  if (!res.ok) return { ok: false, message: `Couldn't send: ${res.error}` };
  try {
    recordOutbound(phone, body, res.message_sid ?? null, res.status ?? null);
  } catch {
    /* sent, but recording is best-effort */
  }
  db.prepare(`UPDATE pending_actions SET status='sent', draft_body=?, decided_at=datetime('now') WHERE id=?`).run(body, id);
  if (a.kind === "lead_follow_up" && a.ref_id) {
    try {
      db.prepare(`UPDATE jobs SET updated_at=datetime('now') WHERE id=?`).run(a.ref_id);
    } catch {
      /* ignore */
    }
  }
  return { ok: true, message: `Sent to ${a.recipient_name || phone}.` };
}
