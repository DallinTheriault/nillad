// Morning briefing: pull a few news/markets feeds + Dallin's own day (calendar,
// reminders, active activities, weather), have the local model compress it into a
// skimmable briefing, then (1) file it into the vault as Briefings/<date>.md so
// Nillad and Obsidian can both read it, and (2) push it to his phone via ntfy.
// Triggered by an n8n cron hitting /api/briefing/run.

import { getDb } from "@/lib/db";
import { getWeather, getMarketSnapshot } from "@/lib/web";
import { writeNote } from "@/lib/vault";
import { humanDenver, parseStored } from "@/lib/datetime";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const NTFY = process.env.NILLAD_NTFY_URL || "http://host.docker.internal:8090";
const NTFY_TOPIC = process.env.NILLAD_BRIEFING_TOPIC || "nillad-briefing";

// Default feeds — swap/add via NILLAD_FEEDS later. Picked for reliable RSS.
const FEEDS: { label: string; url: string }[] = [
  { label: "Tech (Hacker News)", url: "https://hnrss.org/frontpage?points=100" },
  { label: "Politics (NPR)", url: "https://feeds.npr.org/1014/rss.xml" },
  { label: "Markets (WSJ)", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml" },
];

type Item = { title: string; link: string };

async function fetchRss(url: string, n = 6, attempt = 0): Promise<Item[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Nillad/1.0 (personal assistant)" },
      signal: AbortSignal.timeout(9000),
    });
    // One retry on a transient failure — a 6:30am cold-start blip used to wipe the
    // whole news section silently. Better a second try than an empty briefing.
    if (!res.ok) return attempt < 1 ? fetchRss(url, n, attempt + 1) : [];
    const xml = await res.text();
    const clean = (s: string) =>
      s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    const out: Item[] = [];
    const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
    for (const b of blocks.slice(0, n)) {
      const title = clean(b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
      const link =
        clean(b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || "") ||
        (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || "").trim();
      if (title) out.push({ title, link });
    }
    return out;
  } catch {
    return attempt < 1 ? fetchRss(url, n, attempt + 1) : [];
  }
}

function gatherDay(): string {
  const lines: string[] = [];
  try {
    const db = getDb();
    const events = db
      .prepare(
        `SELECT title, start_at, location FROM calendar_events
         WHERE status='confirmed' AND date(start_at) = date('now','localtime')
         ORDER BY start_at LIMIT 20`,
      )
      .all() as { title: string; start_at: string; location: string | null }[];
    if (events.length) {
      lines.push("Today's calendar:");
      for (const e of events)
        lines.push(`- ${humanDenver(parseStored(e.start_at))} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`);
    } else {
      lines.push("Today's calendar: nothing scheduled.");
    }

    const dueReminders = db
      .prepare(
        `SELECT text, due_at FROM reminders WHERE status='pending'
           AND date(due_at) <= date('now','localtime','+1 day')
         ORDER BY due_at LIMIT 20`,
      )
      .all() as { text: string; due_at: string }[];
    if (dueReminders.length) {
      lines.push("Reminders due soon:");
      for (const r of dueReminders) lines.push(`- ${r.text} (${humanDenver(parseStored(r.due_at))})`);
    }

    const acts = db
      .prepare(
        `SELECT a.title,
                (SELECT COUNT(*) FROM tasks t WHERE t.activity_id=a.id AND t.done=0) AS open
         FROM activities a WHERE a.archived_at IS NULL AND a.status='active'
         ORDER BY a.updated_at DESC LIMIT 6`,
      )
      .all() as { title: string; open: number }[];
    if (acts.length) {
      lines.push("Active projects:");
      for (const a of acts) lines.push(`- ${a.title}${a.open ? ` (${a.open} open task${a.open === 1 ? "" : "s"})` : ""}`);
    }
  } catch {
    lines.push("(couldn't read your day from the database)");
  }
  return lines.join("\n");
}

async function ollamaBrief(material: string): Promise<string> {
  const system =
    "You are Nillad, writing Dallin's concise morning briefing. Output skimmable Markdown with these sections, in order, and ONLY these: '## Your day', '## Tech', '## Politics', '## Markets'. Under each, 2-5 tight bullets, one line each, plain language, no hype, no preamble, no sign-off. For news bullets, lead with the gist in your own words. In '## Markets', LEAD with the quoted numbers from MARKET DATA (e.g. 'S&P 500 6,012 (+0.4%)') as their own bullets, then add market headlines. Use the exact prices and percentages given — never invent or alter a number. Drop a section only if there's truly nothing for it. Do not invent items not present in the material.";
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
    return `(briefing model call failed: ${e instanceof Error ? e.message : e})`;
  }
}

async function pushNtfy(title: string, body: string): Promise<void> {
  try {
    await fetch(`${NTFY}/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "3",
        Tags: "sunrise",
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: body.slice(0, 3500),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* push is best-effort */
  }
}

export async function buildBriefing(): Promise<{ note: string; markdown: string }> {
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
  }).format(now); // YYYY-MM-DD

  const [weather, market, ...feedResults] = await Promise.all([
    getWeather().catch(() => "(weather unavailable)"),
    getMarketSnapshot().catch(() => ""),
    ...FEEDS.map((f) => fetchRss(f.url)),
  ]);

  const day = gatherDay();
  const feedBlocks = FEEDS.map((f, i) => {
    const items = feedResults[i] || [];
    if (!items.length) return `${f.label}: (no items)`;
    return `${f.label}:\n` + items.map((it) => `- ${it.title}`).join("\n");
  }).join("\n\n");

  const material = [
    `Date: ${dateLabel}`,
    `Weather (American Fork, UT): ${weather}`,
    "",
    `=== DALLIN'S DAY ===\n${day}`,
    "",
    `=== MARKET DATA (use these exact numbers) ===\n${market || "(market data unavailable)"}`,
    "",
    `=== HEADLINES ===\n${feedBlocks}`,
  ].join("\n");

  const body = await ollamaBrief(material);
  const markdown = `# Morning Briefing — ${dateLabel}\n\n${body}\n`;

  // File into the vault (visible to Nillad + Obsidian) and push to phone.
  // writeNote (not append) so a same-day re-run replaces rather than duplicates.
  writeNote(`Briefings/${dateKey}.md`, markdown);
  await pushNtfy(`Nillad — Briefing, ${dateLabel}`, body || "Briefing generated.");

  return { note: `Briefings/${dateKey}.md`, markdown };
}
