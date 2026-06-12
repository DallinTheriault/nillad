// Universal search — one query, fanned out across every source Nillad knows, with
// results grouped UNDER their parent section (Notes, Axiom Vault, Jobs, Contacts,
// Emails, Texts, Activities, Expenses, Calendar, Reminders). The DB is tiny
// (single-user, low hundreds of rows), so each source just fetches its rows and
// filters in JS — simpler and more forgiving than per-table SQL LIKE, and fast
// enough to feel instant as the user types. Every source is try/caught so a
// missing/empty table can never sink the whole search.

import { getDb } from "@/lib/db";
import { searchNotesStructured } from "@/lib/vault";

export type SearchHit = {
  title: string;
  snippet?: string;
  href?: string; // deep link to where this lives (omit when there's no page)
  meta?: string; // small trailing context (status, date, sender)
};
export type SearchSection = {
  key: string;
  label: string;
  icon: string; // lucide icon name, mapped to a component client-side
  hits: SearchHit[];
};

// Query → lowercase tokens (len ≥ 2). Plural-forgiving: a token matches if the
// haystack contains it OR its singular stem (so "measurements" finds "measurement").
function tokens(q: string): string[] {
  return (q.toLowerCase().match(/[a-z0-9]{2,}/g) || []).filter((t, i, a) => a.indexOf(t) === i);
}
function stem(t: string): string {
  return t.endsWith("s") ? t.slice(0, -1) : t;
}
// Row matches when EVERY token appears somewhere in its searchable text (AND), and
// returns a relevance score (title-weighted) so the best hits sort to the top.
function score(terms: string[], title: string, body: string): number {
  const lt = (title || "").toLowerCase();
  const lb = (body || "").toLowerCase();
  let s = 0;
  for (const t of terms) {
    const st = stem(t);
    const inT = lt.includes(t) || lt.includes(st);
    const inB = lb.includes(t) || lb.includes(st);
    if (!inT && !inB) return 0; // AND: every term must land somewhere
    if (inT) s += 3;
    if (inB) s += 1;
  }
  return s;
}
const trim = (s: unknown, n = 200): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const PER_SECTION = 8;

type Scored = { hit: SearchHit; score: number; recency?: number };
function take(rows: Scored[]): SearchHit[] {
  return rows
    .sort((a, b) => b.score - a.score || (b.recency ?? 0) - (a.recency ?? 0))
    .slice(0, PER_SECTION)
    .map((r) => r.hit);
}

export function searchAll(query: string): SearchSection[] {
  const terms = tokens(query);
  if (!terms.length) return [];
  const db = getDb();
  const sections: SearchSection[] = [];
  const add = (key: string, label: string, icon: string, hits: SearchHit[]) => {
    if (hits.length) sections.push({ key, label, icon, hits });
  };

  // 1) Notes — Nillad's saved memories (the "double door measurement" lives here or in the vault).
  try {
    const rows = db.prepare(`SELECT id, subject, note, updated_at FROM memories`).all() as Array<{
      id: number; subject: string; note: string; updated_at: string;
    }>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const sc = score(terms, r.subject, r.note);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.updated_at) || 0, hit: { title: r.subject || "Note", snippet: trim(r.note) } });
    }
    add("notes", "Notes", "StickyNote", take(hits));
  } catch { /* skip */ }

  // 2) Axiom Vault — markdown notes in the Obsidian vault.
  try {
    const vh = searchNotesStructured(query, PER_SECTION);
    const hits: SearchHit[] = vh.map((h) => {
      const name = h.rel.replace(/\.md$/i, "").split("/").pop() || h.rel;
      return { title: name, snippet: h.snippet, meta: h.rel.includes("/") ? h.rel.split("/").slice(0, -1).join("/") : undefined };
    });
    add("vault", "Axiom Vault", "BookText", hits);
  } catch { /* skip */ }

  // 2b) Documents — uploaded files Nillad has read (contracts, bids, bills, PDFs).
  try {
    const rows = db.prepare(
      `SELECT id, filename, summary, text, kind FROM documents ORDER BY created_at DESC LIMIT 300`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const sc = score(terms, `${r.filename} ${r.summary || ""}`, r.text || "");
      if (sc) hits.push({ score: sc, hit: { title: r.filename, snippet: trim(r.summary || r.text), href: "/documents", meta: r.kind || undefined } });
    }
    add("documents", "Documents", "FileText", take(hits));
  } catch { /* skip */ }

  // 3) Jobs
  try {
    const rows = db.prepare(
      `SELECT id, title, client, location, scope, notes, status, job_type, created_at FROM jobs`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const title = r.title || r.client || "Job";
      const body = [r.scope, r.notes, r.location, r.client, r.job_type].filter(Boolean).join(" • ");
      const sc = score(terms, title, body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.created_at) || 0, hit: { title, snippet: trim(r.scope || r.notes || r.location), href: `/jobs/${r.id}`, meta: r.status } });
    }
    add("jobs", "Jobs", "Briefcase", take(hits));
  } catch { /* skip */ }

  // 4) Contacts
  try {
    const rows = db.prepare(
      `SELECT id, name, phone, email, role, address, notes FROM contacts WHERE archived_at IS NULL`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const body = [r.role, r.phone, r.email, r.address, r.notes].filter(Boolean).join(" • ");
      const sc = score(terms, r.name, body);
      if (sc) hits.push({ score: sc, hit: { title: r.name || r.phone || "Contact", snippet: trim([r.role, r.phone, r.email].filter(Boolean).join(" · ")), href: "/contacts" } });
    }
    add("contacts", "Contacts", "Users", take(hits));
  } catch { /* skip */ }

  // 5) Emails
  try {
    const rows = db.prepare(
      `SELECT id, subject, snippet, summary, from_name, from_addr, date FROM emails WHERE archived = 0`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const body = [r.summary, r.snippet, r.from_name, r.from_addr].filter(Boolean).join(" • ");
      const sc = score(terms, r.subject, body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.date) || 0, hit: { title: r.subject || "(no subject)", snippet: trim(r.summary || r.snippet), href: "/inbox", meta: r.from_name || r.from_addr } });
    }
    add("emails", "Emails", "Mail", take(hits));
  } catch { /* skip */ }

  // 6) Texts
  try {
    const rows = db.prepare(
      `SELECT m.id, m.body, m.created_at, t.display_name, t.contact_phone
       FROM sms_messages m LEFT JOIN sms_threads t ON t.id = m.thread_id`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const who = r.display_name || r.contact_phone || "Text";
      const sc = score(terms, who, r.body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.created_at) || 0, hit: { title: who, snippet: trim(r.body), href: "/messages" } });
    }
    add("texts", "Texts", "MessageSquare", take(hits));
  } catch { /* skip */ }

  // 7) Activities (+ their tasks)
  try {
    const rows = db.prepare(
      `SELECT id, title, notes, category, status, updated_at FROM activities WHERE archived_at IS NULL`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const body = [r.notes, r.category].filter(Boolean).join(" • ");
      const sc = score(terms, r.title, body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.updated_at) || 0, hit: { title: r.title || "Activity", snippet: trim(r.notes || r.category), href: "/activities", meta: r.status } });
    }
    try {
      const tasks = db.prepare(`SELECT id, title FROM tasks`).all() as Array<Record<string, string>>;
      for (const t of tasks) {
        const sc = score(terms, t.title, "");
        if (sc) hits.push({ score: sc - 0.5, hit: { title: t.title, snippet: "Task", href: "/activities" } });
      }
    } catch { /* tasks optional */ }
    add("activities", "Activities", "ListChecks", take(hits));
  } catch { /* skip */ }

  // 8) Expenses
  try {
    const rows = db.prepare(
      `SELECT id, vendor, amount, category, notes, spent_on FROM expenses`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const body = [r.category, r.notes, r.amount].filter(Boolean).join(" • ");
      const sc = score(terms, r.vendor, body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.spent_on) || 0, hit: { title: r.vendor || "Expense", snippet: trim([r.category, r.amount ? `$${r.amount}` : "", r.notes].filter(Boolean).join(" · ")), href: "/expenses" } });
    }
    add("expenses", "Expenses", "Receipt", take(hits));
  } catch { /* skip */ }

  // 9) Calendar
  try {
    const rows = db.prepare(
      `SELECT id, title, location, description, start_at FROM calendar_events WHERE status != 'cancelled'`,
    ).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const body = [r.location, r.description].filter(Boolean).join(" • ");
      const sc = score(terms, r.title, body);
      if (sc) hits.push({ score: sc, recency: Date.parse(r.start_at) || 0, hit: { title: r.title || "Event", snippet: trim([r.location, r.description].filter(Boolean).join(" · ")), href: "/calendar", meta: r.start_at ? r.start_at.slice(0, 10) : undefined } });
    }
    add("calendar", "Calendar", "Calendar", take(hits));
  } catch { /* skip */ }

  // 10) Reminders
  try {
    const rows = db.prepare(`SELECT id, text, due_at, status FROM reminders`).all() as Array<Record<string, string>>;
    const hits: Scored[] = [];
    for (const r of rows) {
      const sc = score(terms, r.text, "");
      if (sc) hits.push({ score: sc, recency: Date.parse(r.due_at) || 0, hit: { title: r.text, href: "/reminders", meta: r.status } });
    }
    add("reminders", "Reminders", "Bell", take(hits));
  } catch { /* skip */ }

  return sections;
}
