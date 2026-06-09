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
