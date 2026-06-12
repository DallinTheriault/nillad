// Evening review — the bookend to the morning briefing. Instead of news, it
// closes Dallin's loops: open jobs, money owed (unpaid invoices), quiet leads to
// follow up, tomorrow's schedule vs weather (flagging outdoor jobs on bad-weather
// days), and unanswered texts/emails. gemma compresses it, it lands in the vault
// and on the nillad-evening ntfy topic. Triggered by an n8n cron ~5:30pm.

import { getDb } from "@/lib/db";
import { getWeather } from "@/lib/web";
import { writeNote } from "@/lib/vault";
import { pushNtfy } from "@/lib/notify";
import { humanDenver, parseStored } from "@/lib/datetime";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const EVENING_TOPIC = process.env.NILLAD_EVENING_TOPIC || "nillad-evening";
const money = (n: number) => `$${(n || 0).toFixed(2)}`;

// Each query is wrapped so a missing/empty table never sinks the whole review.
function q<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function gatherLoops(): string {
  const db = getDb();
  const lines: string[] = [];

  // Open jobs (in-flight work).
  const openJobs = q(
    () =>
      db
        .prepare(
          `SELECT id, COALESCE(title, client, '(untitled)') AS name, status, client
           FROM jobs WHERE COALESCE(status,'lead') IN ('quoted','scheduled','active','done','invoiced')
             AND COALESCE(paid,0)=0
           ORDER BY updated_at DESC LIMIT 12`,
        )
        .all() as { id: number; name: string; status: string; client: string | null }[],
    [],
  );
  if (openJobs.length) {
    lines.push("OPEN JOBS:");
    for (const j of openJobs) lines.push(`- #${j.id} ${j.name} [${j.status}]${j.client ? ` · ${j.client}` : ""}`);
  }

  // Money owed — invoices sent but not paid.
  const unpaid = q(
    () =>
      db
        .prepare(
          `SELECT i.number, i.total, i.sent_at, i.biller, COALESCE(j.title,j.client,'job') AS job
           FROM invoices i LEFT JOIN jobs j ON j.id=i.job_id
           WHERE i.status='sent' ORDER BY i.sent_at ASC LIMIT 20`,
        )
        .all() as { number: string; total: number; sent_at: string | null; biller: string | null; job: string }[],
    [],
  );
  if (unpaid.length) {
    const owed = unpaid.reduce((s, i) => s + (i.total || 0), 0);
    lines.push(`MONEY OWED: ${money(owed)} across ${unpaid.length} invoice(s):`);
    for (const i of unpaid) lines.push(`- ${i.number} ${money(i.total)} — ${i.job}${i.sent_at ? ` (sent ${i.sent_at.slice(0, 10)})` : ""}`);
  }

  // Follow-up nudges: invoices sent ≥3 days ago still unpaid, + quiet leads/quotes.
  const staleInv = q(
    () =>
      db
        .prepare(
          `SELECT i.number, i.total, COALESCE(j.title,j.client,'job') AS job
           FROM invoices i LEFT JOIN jobs j ON j.id=i.job_id
           WHERE i.status='sent' AND i.sent_at IS NOT NULL
             AND datetime(i.sent_at) <= datetime('now','-3 days')
           ORDER BY i.sent_at ASC LIMIT 10`,
        )
        .all() as { number: string; total: number; job: string }[],
    [],
  );
  const quietLeads = q(
    () =>
      db
        .prepare(
          `SELECT id, COALESCE(title,client,'(untitled)') AS name, status, updated_at
           FROM jobs WHERE COALESCE(status,'lead') IN ('lead','quoted')
             AND COALESCE(paid,0)=0
             AND datetime(COALESCE(updated_at,created_at)) <= datetime('now','-3 days')
           ORDER BY updated_at ASC LIMIT 10`,
        )
        .all() as { id: number; name: string; status: string; updated_at: string }[],
    [],
  );
  if (staleInv.length || quietLeads.length) {
    lines.push("FOLLOW UP (no movement in 3+ days):");
    for (const i of staleInv) lines.push(`- Unpaid: ${i.number} ${money(i.total)} — ${i.job} (nudge the client)`);
    for (const l of quietLeads) lines.push(`- Quiet ${l.status}: #${l.id} ${l.name} (no update since ${l.updated_at?.slice(0, 10)})`);
  }

  // Tomorrow: calendar events + jobs scheduled tomorrow (weather conflict check).
  const tEvents = q(
    () =>
      db
        .prepare(
          `SELECT title, start_at, location FROM calendar_events
           WHERE status='confirmed' AND date(start_at)=date('now','localtime','+1 day')
           ORDER BY start_at LIMIT 20`,
        )
        .all() as { title: string; start_at: string; location: string | null }[],
    [],
  );
  const tJobs = q(
    () =>
      db
        .prepare(
          `SELECT COALESCE(title,client,'job') AS name, scope, location FROM jobs
           WHERE date(scheduled_date)=date('now','localtime','+1 day') LIMIT 20`,
        )
        .all() as { name: string; scope: string | null; location: string | null }[],
    [],
  );
  if (tEvents.length || tJobs.length) {
    lines.push("TOMORROW:");
    for (const e of tEvents) lines.push(`- ${humanDenver(parseStored(e.start_at))} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`);
    for (const j of tJobs) lines.push(`- Job: ${j.name}${j.scope ? ` (${j.scope.slice(0, 60)})` : ""}${j.location ? ` @ ${j.location}` : ""}`);
  }

  // Unanswered: inbound texts with no reply after + important unread emails.
  const unreplied = q(
    () =>
      db
        .prepare(
          `SELECT contact_phone, last_message_preview, last_inbound_at FROM sms_threads
           WHERE last_inbound_at IS NOT NULL
             AND (last_outbound_at IS NULL OR datetime(last_inbound_at) > datetime(last_outbound_at))
             AND archived_at IS NULL
           ORDER BY last_inbound_at DESC LIMIT 8`,
        )
        .all() as { contact_phone: string; last_message_preview: string | null; last_inbound_at: string }[],
    [],
  );
  const importantMail = q(
    () =>
      db
        .prepare(
          `SELECT from_name, from_addr, subject FROM emails
           WHERE important=1 AND seen=0 AND archived=0 ORDER BY date DESC LIMIT 8`,
        )
        .all() as { from_name: string | null; from_addr: string | null; subject: string | null }[],
    [],
  );
  if (unreplied.length || importantMail.length) {
    lines.push("NEEDS A REPLY:");
    for (const t of unreplied) lines.push(`- Text from ${t.contact_phone}: "${(t.last_message_preview || "").slice(0, 60)}"`);
    for (const m of importantMail) lines.push(`- Email from ${m.from_name || m.from_addr || "?"}: ${m.subject || "(no subject)"}`);
  }

  // Reminders due / overdue.
  const dueRem = q(
    () =>
      db
        .prepare(
          `SELECT text, due_at FROM reminders WHERE status='pending'
             AND date(due_at) <= date('now','localtime','+1 day') ORDER BY due_at LIMIT 12`,
        )
        .all() as { text: string; due_at: string }[],
    [],
  );
  if (dueRem.length) {
    lines.push("REMINDERS:");
    for (const r of dueRem) lines.push(`- ${r.text} (${humanDenver(parseStored(r.due_at))})`);
  }

  return lines.length ? lines.join("\n") : "Nothing open — clear plate.";
}

async function ollamaReview(material: string): Promise<string> {
  const system =
    "You are Nillad, writing Dallin's end-of-day review — a contractor/painter closing his loops before tomorrow. Output skimmable Markdown with these sections, in order, and ONLY the ones that have content: '## Money' (unpaid invoices / total owed — lead with the dollar figure), '## Follow up' (who to nudge — quiet quotes, unpaid invoices past 3 days), '## Tomorrow' (schedule + jobs; if an OUTDOOR or painting job is scheduled and tomorrow's weather looks wet/cold/bad, FLAG it explicitly as a conflict), '## Reply' (texts/emails awaiting his response), '## Open work' (jobs in flight), '## Reminders'. 2-5 tight bullets each, one line, plain and direct, no preamble, no sign-off. Use the exact dollar amounts and names from the material — never invent. If a section has nothing, omit it. End with nothing if the plate is clear.";
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: material },
        ],
        think: false,
        stream: false,
        options: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    return (j.message?.content || "").trim();
  } catch (e) {
    return `(evening review model call failed: ${e instanceof Error ? e.message : e})`;
  }
}

export async function buildEveningReview(): Promise<{ note: string; markdown: string }> {
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(now);

  const weather = await getWeather().catch(() => "(weather unavailable)");
  const loops = gatherLoops();

  const material = [
    `Date: ${dateLabel} (evening)`,
    `Weather (American Fork, UT) — current + next 3 days:\n${weather}`,
    "",
    `=== DALLIN'S OPEN LOOPS ===\n${loops}`,
  ].join("\n");

  const body = await ollamaReview(material);
  const markdown = `# Evening Review — ${dateLabel}\n\n${body}\n`;

  writeNote(`Reviews/${dateKey}.md`, markdown);
  await pushNtfy(EVENING_TOPIC, `Nillad — Evening Review`, body || "Nothing open — clear plate.", {
    priority: 3,
    tags: "city_sunset",
  });

  return { note: `Reviews/${dateKey}.md`, markdown };
}
