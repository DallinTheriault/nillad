import { getDb } from "@/lib/db";
import { parseStored, shortRelative } from "@/lib/datetime";

// Real, contextual home-screen prompts derived from live state — the most
// recently-touched activity and the soonest upcoming reminder — instead of
// static stubs. Each suggestion carries the `query` that gets sent to Nillad
// chat when tapped. Server-side, DB-direct (same tables the chat tools use),
// so the home screen stays instant and $0.

export type Suggestion = { text: string; query: string };

type ActivityRow = { id: number; title: string; total: number; done: number };
type ReminderRow = { text: string; due_at: string };

export function getHomeSuggestions(): Suggestion[] {
  const out: Suggestion[] = [];
  let activity: ActivityRow | undefined;
  let reminder: ReminderRow | undefined;

  try {
    const db = getDb();
    activity = db
      .prepare(
        `SELECT a.id, a.title,
                (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id) AS total,
                (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.done = 1) AS done
         FROM activities a
         WHERE a.archived_at IS NULL AND a.status = 'active'
         ORDER BY a.updated_at DESC LIMIT 1`,
      )
      .get() as ActivityRow | undefined;

    // Soonest pending reminder still in the future (don't surface stale ones).
    const pending = db
      .prepare(
        `SELECT text, due_at FROM reminders WHERE status = 'pending' ORDER BY due_at ASC LIMIT 20`,
      )
      .all() as ReminderRow[];
    reminder = pending.find((r) => parseStored(r.due_at).getTime() > Date.now());
  } catch {
    // DB unavailable — fall through to generic prompts below.
  }

  if (activity) {
    const left = (activity.total ?? 0) - (activity.done ?? 0);
    const tasks = left > 0 ? ` ${left} task${left === 1 ? "" : "s"} left.` : "";
    out.push({
      text: `Pick up where we left off on “${activity.title}”?${tasks}`,
      query: `Let's continue with "${activity.title}". Remind me where we left off and what's next.`,
    });
  }

  if (reminder) {
    const rel = shortRelative(parseStored(reminder.due_at));
    out.push({
      text: `Heads up — “${reminder.text}” is due ${rel}.`,
      query: `My reminder "${reminder.text}" is coming up ${rel}. Help me get ready for it.`,
    });
  }

  // Always offer an open-ended action; it's the anchor when nothing else applies.
  out.push({
    text: out.length ? `Anything else you want me to handle?` : `Anything you want me to handle right now?`,
    query: `What should I focus on right now?`,
  });

  if (out.length === 1) {
    // Cold start (no activity, no reminder) — give a second inviting prompt.
    out.unshift({
      text: `Are we continuing something, or starting fresh?`,
      query: `Help me figure out what to work on. What do you know about what I've got going on?`,
    });
  }

  return out.slice(0, 3);
}

// ---- Recent chats to resume ("want to continue on…") ----
export type RecentChat = { id: number; title: string; when: string; snippet: string };

export function getRecentChats(limit = 4): RecentChat[] {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.updated_at,
                (SELECT content FROM chat_messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last
         FROM chats c
         WHERE EXISTS (SELECT 1 FROM chat_messages m WHERE m.chat_id = c.id)
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(limit) as { id: number; title: string | null; updated_at: string; last: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      title: (r.title || (r.last ? r.last.slice(0, 36) : "Chat")).trim(),
      when: shortRelative(parseStored(r.updated_at)) || "",
      snippet: (r.last || "").replace(/\s+/g, " ").trim().slice(0, 64),
    }));
  } catch {
    return [];
  }
}

// ---- Heads-up: things to see immediately on the home screen ----
export type HomeAlert = {
  kind: "reminder" | "job" | "invoice" | "email" | "approval";
  text: string;
  href: string;
  tone: "red" | "amber" | "normal";
};

export function getHomeAlerts(): HomeAlert[] {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    return [];
  }
  const q = <T,>(fn: () => T, fb: T): T => {
    try {
      return fn();
    } catch {
      return fb;
    }
  };
  const out: HomeAlert[] = [];
  const now = Date.now();
  const soon = now + 16 * 3600 * 1000; // next 16h

  // Reminders overdue or due soon (pending).
  const rems = q(
    () => db.prepare(`SELECT text, due_at FROM reminders WHERE status='pending' ORDER BY due_at ASC LIMIT 40`).all() as { text: string; due_at: string }[],
    [],
  );
  for (const r of rems) {
    const t = parseStored(r.due_at).getTime();
    if (!Number.isFinite(t) || t > soon) continue;
    const overdue = t < now;
    out.push({
      kind: "reminder",
      text: overdue ? `${r.text} — overdue` : `${r.text} — due ${shortRelative(parseStored(r.due_at))}`,
      href: "/reminders",
      tone: overdue ? "red" : "amber",
    });
  }

  // Jobs scheduled today.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const jt = q(() => db.prepare(`SELECT COUNT(*) n FROM jobs WHERE scheduled_date=?`).get(today) as { n: number }, { n: 0 });
  if (jt.n > 0) out.push({ kind: "job", text: `${jt.n} job${jt.n > 1 ? "s" : ""} scheduled today`, href: "/jobs", tone: "normal" });

  // Unpaid invoices.
  const inv = q(() => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) amt FROM invoices WHERE status='sent'`).get() as { n: number; amt: number }, { n: 0, amt: 0 });
  if (inv.n > 0) out.push({ kind: "invoice", text: `${inv.n} unpaid invoice${inv.n > 1 ? "s" : ""} · $${Math.round(inv.amt).toLocaleString()} owed`, href: "/dashboard", tone: "amber" });

  // Important unread emails.
  const em = q(() => db.prepare(`SELECT COUNT(*) n FROM emails WHERE important=1 AND seen=0 AND archived=0`).get() as { n: number }, { n: 0 });
  if (em.n > 0) out.push({ kind: "email", text: `${em.n} important email${em.n > 1 ? "s" : ""}`, href: "/inbox", tone: "normal" });

  // Drafts awaiting approval.
  const ap = q(() => db.prepare(`SELECT COUNT(*) n FROM pending_actions WHERE status='pending'`).get() as { n: number }, { n: 0 });
  if (ap.n > 0) out.push({ kind: "approval", text: `${ap.n} draft${ap.n > 1 ? "s" : ""} awaiting approval`, href: "/approvals", tone: "normal" });

  const rank = { red: 0, amber: 1, normal: 2 } as const;
  out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  return out.slice(0, 2); // keep home uncluttered — only the most urgent; the rest live on their pages
}
