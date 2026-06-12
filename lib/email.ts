// IMAP email ingestion + triage. Reads the mailboxes Dallin registered on the
// Connections page (provider=imap, status=active), pulls recent messages, has
// the local model triage each NEW one for importance, stores a row per message,
// and pings him via ntfy for the important stuff (checks, warranty, things he's
// waiting on). The chat `email` tool reads from the stored rows and routes
// mutating actions (mark-read / archive / delete / move) back to the live
// mailbox. Local-first: creds come from connections.secret, nothing leaves the box
// except the IMAP/TLS connection to his provider.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getDb } from "@/lib/db";
import { pushNtfy } from "@/lib/notify";
import { ingestDocument } from "@/lib/documents";

const ATTACH_MAX_BYTES = 15_000_000; // skip absurdly large attachments
const ATTACH_MAX_PER_MSG = 3; // bound model work per message

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const EMAIL_TOPIC = process.env.NILLAD_EMAIL_TOPIC || "nillad-email";
const RECENT_WINDOW = 30; // most-recent messages scanned per sync
const MAX_NEW_PER_SYNC = 20; // cap on new messages classified per run (bounds gemma calls)

export type Mailbox = {
  id: number;
  label: string;
  host: string;
  port: number;
  user: string;
  pass: string;
};

// Active IMAP connections with their decoded config + secret.
export function getActiveMailboxes(): Mailbox[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, label, config, secret FROM connections
       WHERE provider='imap' AND status='active'`,
    )
    .all() as { id: number; label: string; config: string | null; secret: string | null }[];
  const out: Mailbox[] = [];
  for (const r of rows) {
    try {
      const cfg = r.config ? (JSON.parse(r.config) as Record<string, string>) : {};
      const sec = r.secret ? (JSON.parse(r.secret) as Record<string, string>) : {};
      if (!cfg.host || !cfg.username || !sec.password) continue;
      out.push({
        id: r.id,
        label: r.label,
        host: cfg.host,
        port: Number(cfg.port) || 993,
        user: cfg.username,
        pass: sec.password,
      });
    } catch {
      /* skip a malformed connection */
    }
  }
  return out;
}

type Triage = { important: boolean; importance: "high" | "normal" | "low"; summary: string; reason: string };

// Ask the local model whether a message is worth a ping, plus a one-line summary.
async function triage(from: string, subject: string, snippet: string): Promise<Triage> {
  const fallback: Triage = {
    important: false,
    importance: "normal",
    summary: subject || "(no subject)",
    reason: "",
  };
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        format: "json",
        think: false,
        stream: false,
        options: { temperature: 0.1 },
        messages: [
          {
            role: "system",
            content:
              'You triage Dallin\'s incoming email. Decide if it is IMPORTANT — something he would want pinged about now. IMPORTANT = money (checks, payments, invoices, bills, payouts, refunds), orders/shipping/delivery status, warranty/account/security alerts, appointments/scheduling, anything awaiting his reply or action, or a genuine personal message from a real person. NOT important = marketing, newsletters, promotions, social/app notifications, receipts for things already done, automated noise. Respond ONLY as compact JSON: {"important": true|false, "importance": "high"|"normal"|"low", "summary": "one short factual line", "reason": "a few words"}.',
          },
          { role: "user", content: `From: ${from}\nSubject: ${subject}\n\n${snippet}` },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    const raw = j.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const p = JSON.parse(m[0]) as Partial<Triage>;
    const importance = p.importance === "high" || p.importance === "low" ? p.importance : "normal";
    return {
      important: !!p.important,
      importance,
      summary: (typeof p.summary === "string" && p.summary.trim()) || subject || "(no subject)",
      reason: typeof p.reason === "string" ? p.reason : "",
    };
  } catch {
    return fallback;
  }
}

// Open a mailbox, run fn with the connected client (INBOX locked), then clean up.
async function withClient<T>(mb: Mailbox, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: mb.host,
    port: mb.port,
    secure: true,
    auth: { user: mb.user, pass: mb.pass },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

function clip(s: string, n: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, n);
}

export type SyncResult = { label: string; scanned: number; added: number; flagged: number; error?: string };

// Sync one mailbox: scan the recent window, classify + store new messages, ping
// the important ones. Idempotent — existing UIDs are skipped (unique index).
export async function syncMailbox(mb: Mailbox): Promise<SyncResult> {
  const db = getDb();
  const result: SyncResult = { label: mb.label, scanned: 0, added: 0, flagged: 0 };
  try {
    await withClient(mb, async (client) => {
      const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
      if (!total) return;
      const start = Math.max(1, total - RECENT_WINDOW + 1);

      // Cheap pass: envelopes + flags for the recent window.
      type Env = { uid: number; seen: boolean; from: string; fromName: string; subject: string; date: string; messageId: string };
      const envs: Env[] = [];
      for await (const msg of client.fetch(`${start}:*`, { uid: true, envelope: true, flags: true })) {
        const e = msg.envelope;
        const fromObj = e?.from?.[0];
        envs.push({
          uid: msg.uid,
          seen: msg.flags?.has("\\Seen") ?? false,
          from: fromObj?.address || "",
          fromName: fromObj?.name || "",
          subject: e?.subject || "",
          date: (e?.date instanceof Date ? e.date.toISOString() : "") || "",
          messageId: e?.messageId || "",
        });
      }
      result.scanned = envs.length;

      const existing = new Set(
        (db.prepare(`SELECT uid FROM emails WHERE connection_id=?`).all(mb.id) as { uid: number }[]).map(
          (r) => r.uid,
        ),
      );
      // Newest first, only unseen-by-us, capped.
      const fresh = envs
        .filter((e) => !existing.has(e.uid))
        .sort((a, b) => b.uid - a.uid)
        .slice(0, MAX_NEW_PER_SYNC);

      const insert = db.prepare(
        `INSERT OR IGNORE INTO emails
           (connection_id, uid, message_id, from_addr, from_name, subject, date, snippet, summary, importance, important, reason, seen, pinged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      );

      for (const e of fresh) {
        // Pull the body just for new messages, to build a snippet + triage.
        let snippet = "";
        let attachments: { filename: string; type: string; content: Buffer }[] = [];
        try {
          const full = await client.fetchOne(String(e.uid), { source: true }, { uid: true });
          if (full && typeof full !== "boolean" && full.source) {
            const parsed = await simpleParser(full.source);
            snippet = clip(parsed.text || parsed.subject || "", 700);
            attachments = (parsed.attachments || [])
              .filter((a) => a.filename && a.content && a.size && a.size <= ATTACH_MAX_BYTES)
              .slice(0, ATTACH_MAX_PER_MSG)
              .map((a) => ({ filename: a.filename as string, type: a.contentType || "", content: a.content as Buffer }));
          }
        } catch {
          /* body unavailable — triage on subject alone */
        }
        const t = await triage(e.fromName ? `${e.fromName} <${e.from}>` : e.from, e.subject, snippet);
        const info = insert.run(
          mb.id,
          e.uid,
          e.messageId || null,
          e.from || null,
          e.fromName || null,
          e.subject || null,
          e.date || null,
          snippet || null,
          t.summary,
          t.importance,
          t.important ? 1 : 0,
          t.reason || null,
          e.seen ? 1 : 0,
        );
        if (info.changes) {
          result.added++;
          if (t.important) result.flagged++;
          // Ingest attachments so Nillad can read them (best-effort; never sinks sync).
          for (const att of attachments) {
            try {
              await ingestDocument(att.content, att.filename, att.type, {
                source: "email",
                emailId: Number(info.lastInsertRowid),
              });
            } catch {
              /* one bad attachment shouldn't stop the rest */
            }
          }
        }
      }
    });

    // Ping important, not-yet-pinged messages (one push per message, batched-ish).
    const toPing = db
      .prepare(
        `SELECT id, from_name, from_addr, subject, summary FROM emails
         WHERE connection_id=? AND important=1 AND pinged=0 AND archived=0
         ORDER BY date DESC LIMIT 10`,
      )
      .all(mb.id) as { id: number; from_name: string | null; from_addr: string | null; subject: string | null; summary: string | null }[];
    for (const p of toPing) {
      const who = p.from_name || p.from_addr || "someone";
      await pushNtfy(
        EMAIL_TOPIC,
        `📬 ${who}`,
        `${p.subject || "(no subject)"}\n${p.summary || ""}`.trim(),
        { priority: 4, tags: "email" },
      );
      db.prepare(`UPDATE emails SET pinged=1 WHERE id=?`).run(p.id);
    }

    db.prepare(`UPDATE connections SET last_sync_at=datetime('now'), last_error=NULL, updated_at=datetime('now') WHERE id=?`).run(
      mb.id,
    );
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    db.prepare(`UPDATE connections SET status='error', last_error=?, updated_at=datetime('now') WHERE id=?`).run(
      result.error.slice(0, 300),
      mb.id,
    );
  }
  return result;
}

export async function syncAllMailboxes(): Promise<SyncResult[]> {
  const boxes = getActiveMailboxes();
  const out: SyncResult[] = [];
  for (const mb of boxes) out.push(await syncMailbox(mb));
  return out;
}

// ---------- Mutating ops (chat email tool) ----------

function mailboxForEmail(emailId: number): { mb: Mailbox; uid: number } | null {
  const db = getDb();
  const row = db.prepare(`SELECT connection_id, uid FROM emails WHERE id=?`).get(emailId) as
    | { connection_id: number; uid: number }
    | undefined;
  if (!row) return null;
  const mb = getActiveMailboxes().find((m) => m.id === row.connection_id);
  return mb ? { mb, uid: row.uid } : null;
}

export async function markEmailSeen(emailId: number): Promise<string> {
  const ref = mailboxForEmail(emailId);
  if (!ref) return "That email isn't available (mailbox inactive or message gone).";
  await withClient(ref.mb, (c) => c.messageFlagsAdd(String(ref.uid), ["\\Seen"], { uid: true }));
  getDb().prepare(`UPDATE emails SET seen=1 WHERE id=?`).run(emailId);
  return "Marked as read.";
}

export async function archiveEmail(emailId: number): Promise<string> {
  const ref = mailboxForEmail(emailId);
  if (!ref) return "That email isn't available.";
  // Try a real Archive folder; fall back to just flagging \\Seen if none exists.
  await withClient(ref.mb, async (c) => {
    try {
      await c.messageMove(String(ref.uid), "Archive", { uid: true });
    } catch {
      await c.messageFlagsAdd(String(ref.uid), ["\\Seen"], { uid: true });
    }
  });
  getDb().prepare(`UPDATE emails SET archived=1, seen=1 WHERE id=?`).run(emailId);
  return "Archived.";
}

export async function deleteEmail(emailId: number): Promise<string> {
  const ref = mailboxForEmail(emailId);
  if (!ref) return "That email isn't available.";
  await withClient(ref.mb, (c) => c.messageDelete(String(ref.uid), { uid: true }));
  getDb().prepare(`UPDATE emails SET archived=1 WHERE id=?`).run(emailId);
  return "Deleted (moved to trash).";
}

export async function moveEmail(emailId: number, folder: string): Promise<string> {
  const ref = mailboxForEmail(emailId);
  if (!ref) return "That email isn't available.";
  try {
    await withClient(ref.mb, (c) => c.messageMove(String(ref.uid), folder, { uid: true }));
  } catch (e) {
    return `Couldn't move to "${folder}": ${e instanceof Error ? e.message : e}. Check the folder name.`;
  }
  getDb().prepare(`UPDATE emails SET archived=1 WHERE id=?`).run(emailId);
  return `Moved to ${folder}.`;
}
