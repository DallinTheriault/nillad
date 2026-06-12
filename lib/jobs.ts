// Jobs & Estimates data layer: rich job records, line items, AI "create from
// activity", and the estimate/invoice lifecycle (build a snapshot → present →
// text it to the client). Local-first; SMS goes out the existing n8n→Twilio path.

import { getDb } from "@/lib/db";
import { sendSmsViaN8n } from "@/lib/n8n";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";

// The two businesses that bill. TPS is the default / does all labor +
// contracting/construction; Sharpline (a DBA of TPS) does interior painting only.
// Letterhead details come from Dallin's real invoices; names overridable via env.
export type Business = {
  key: "tps" | "sharpline";
  name: string;
  dba: string | null;
  address: string;
  phone: string;
  email: string;
  venmo: string;
  accent: string; // print accent color
};
// Business contact details for the invoice letterhead. Real values come from env
// (kept out of the public repo); the in-code defaults are generic placeholders.
const BIZ_ADDRESS = process.env.NILLAD_BIZ_ADDRESS || "123 Example Ave, Demo City, ST 00000";
const BIZ_PHONE = process.env.NILLAD_BIZ_PHONE || "(555) 555-0123";
const BIZ_EMAIL = process.env.NILLAD_BIZ_EMAIL || "billing@example.com";
const BIZ_VENMO = process.env.NILLAD_BIZ_VENMO || "@demo-pay";

export const BUSINESSES: Record<"tps" | "sharpline", Business> = {
  tps: {
    key: "tps",
    name: process.env.NILLAD_BIZ_TPS || "Theriault Property Services LLC",
    dba: null,
    address: BIZ_ADDRESS,
    phone: BIZ_PHONE,
    email: BIZ_EMAIL,
    venmo: BIZ_VENMO,
    accent: "#1f3a5f",
  },
  sharpline: {
    key: "sharpline",
    name: process.env.NILLAD_BIZ_SHARPLINE || "Sharpline Painting Co.",
    dba: "A DBA of Theriault Property Services LLC",
    address: BIZ_ADDRESS,
    phone: BIZ_PHONE,
    email: BIZ_EMAIL,
    venmo: BIZ_VENMO,
    accent: "#0e7490",
  },
};
export type BillerKey = keyof typeof BUSINESSES;

// Resolve the business profile for an invoice from its stored biller (name or key).
export function businessFor(biller: string | null): Business {
  if (biller === "sharpline" || biller === BUSINESSES.sharpline.name) return BUSINESSES.sharpline;
  return BUSINESSES.tps;
}

// Which business bills a job. Rule (Dallin's): if the work is painting-only —
// the scope mentions paint and NOTHING mentions construction/repair work — then
// Sharpline bills; otherwise TPS (the default, and whenever both happen).
const PAINT_RE = /\b(interior paint|touch[- ]?up|repaint|full paint|painting|paint)\b/i;
// Repair/replace/build-type signals (Dallin's "fixed/repaired/replaced/etc").
// Deliberately NOT including paint-ambiguous nouns (trim, door, window, floor,
// tile) since those routinely appear in a painting scope ("paint the trim").
const CONSTRUCTION_RE =
  /\b(fix|fixed|repair|repaired|replace|replaced|install|installed|build|built|construct|construction|remodel|renovat\w*|demo|drywall|plumb\w*|electric\w*|roof\w*|concrete|foundation|framing|hvac|stucco)\b/i;

export function pickBiller(job: { title?: string | null; scope?: string | null; notes?: string | null }): BillerKey {
  const text = `${job.title || ""} ${job.scope || ""} ${job.notes || ""}`;
  if (PAINT_RE.test(text) && !CONSTRUCTION_RE.test(text)) return "sharpline";
  return "tps";
}

export const JOB_STATUSES = ["lead", "quoted", "scheduled", "active", "done", "invoiced", "paid"] as const;

export type Job = {
  id: number;
  title: string | null;
  client: string | null;
  location: string | null;
  job_type: string | null;
  scope: string | null;
  status: string | null;
  contact_id: number | null;
  quoted_price: number | null;
  amount: number | null;
  paid: number;
  paid_at: string | null;
  scheduled_date: string | null;
  notes: string | null;
  activity_id: number | null;
  created_at: string;
  updated_at: string | null;
};
export type LineItem = { id: number; job_id: number; description: string; qty: number; unit_price: number; sort_order: number };
export type Contact = { id: number; name: string | null; phone: string | null; email: string | null; address: string | null };
export type Invoice = {
  id: number;
  job_id: number;
  kind: string;
  number: string | null;
  status: string;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  issued_on: string | null;
  due_on: string | null;
  notes: string | null;
  items_json: string | null;
  biller: string | null;
  stripe_payment_link_id: string | null;
  stripe_url: string | null;
  paid_at: string | null;
  created_at: string;
  sent_at: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
export const money = (n: number) => `$${(n || 0).toFixed(2)}`;

export function listJobs(): (Job & { contact_name: string | null; items_total: number })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT j.*, c.name AS contact_name,
              COALESCE((SELECT SUM(qty*unit_price) FROM job_line_items li WHERE li.job_id=j.id),0) AS items_total
       FROM jobs j LEFT JOIN contacts c ON c.id=j.contact_id
       ORDER BY j.updated_at DESC, j.id DESC LIMIT 200`,
    )
    .all() as (Job & { contact_name: string | null; items_total: number })[];
}

export function getJob(id: number): { job: Job; contact: Contact | null; items: LineItem[]; invoices: Invoice[] } | null {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id) as Job | undefined;
  if (!job) return null;
  const contact = job.contact_id
    ? (db.prepare(`SELECT id,name,phone,email,address FROM contacts WHERE id=?`).get(job.contact_id) as Contact | undefined) || null
    : null;
  const items = db.prepare(`SELECT * FROM job_line_items WHERE job_id=? ORDER BY sort_order, id`).all(id) as LineItem[];
  const invoices = db.prepare(`SELECT * FROM invoices WHERE job_id=? ORDER BY created_at DESC`).all(id) as Invoice[];
  return { job, contact, items, invoices };
}

export function createJob(fields: Partial<Job>): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO jobs (title, client, location, job_type, scope, status, contact_id, quoted_price, scheduled_date, notes, activity_id, paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
    )
    .run(
      fields.title || null,
      fields.client || null,
      fields.location || null,
      fields.job_type || null,
      fields.scope || null,
      fields.status || "lead",
      fields.contact_id ?? null,
      fields.quoted_price ?? null,
      fields.scheduled_date || null,
      fields.notes || null,
      fields.activity_id ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function updateJob(id: number, fields: Partial<Job>): void {
  const db = getDb();
  const allowed: (keyof Job)[] = [
    "title", "client", "location", "job_type", "scope", "status",
    "contact_id", "quoted_price", "amount", "scheduled_date", "notes",
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k}=?`);
      vals.push((fields as Record<string, unknown>)[k] ?? null);
    }
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=?`).run(...vals);
}

export function setPaid(id: number, paid: boolean): void {
  getDb()
    .prepare(`UPDATE jobs SET paid=?, paid_at=?, status=CASE WHEN ? THEN 'paid' ELSE status END, updated_at=datetime('now') WHERE id=?`)
    .run(paid ? 1 : 0, paid ? today() : null, paid ? 1 : 0, id);
  if (paid) getDb().prepare(`UPDATE invoices SET status='paid' WHERE job_id=? AND status!='paid'`).run(id);
}

// ---------- Line items ----------

export function addLineItem(jobId: number, description: string, qty: number, unitPrice: number): number {
  const db = getDb();
  const max = db.prepare(`SELECT COALESCE(MAX(sort_order),0) m FROM job_line_items WHERE job_id=?`).get(jobId) as { m: number };
  const info = db
    .prepare(`INSERT INTO job_line_items (job_id, description, qty, unit_price, sort_order) VALUES (?,?,?,?,?)`)
    .run(jobId, description, qty || 1, unitPrice || 0, (max?.m ?? 0) + 1);
  db.prepare(`UPDATE jobs SET updated_at=datetime('now') WHERE id=?`).run(jobId);
  return Number(info.lastInsertRowid);
}
export function updateLineItem(id: number, f: { description?: string; qty?: number; unit_price?: number }): void {
  const db = getDb();
  const cur = db.prepare(`SELECT * FROM job_line_items WHERE id=?`).get(id) as LineItem | undefined;
  if (!cur) return;
  db.prepare(`UPDATE job_line_items SET description=?, qty=?, unit_price=? WHERE id=?`).run(
    f.description ?? cur.description,
    f.qty ?? cur.qty,
    f.unit_price ?? cur.unit_price,
    id,
  );
}
export function deleteLineItem(id: number): void {
  getDb().prepare(`DELETE FROM job_line_items WHERE id=?`).run(id);
}

// ---------- Create from activity (AI seed) ----------

export async function createJobFromActivity(activityId: number): Promise<{ id: number } | { error: string }> {
  const db = getDb();
  const act = db.prepare(`SELECT id, title, notes, contact_id FROM activities WHERE id=?`).get(activityId) as
    | { id: number; title: string; notes: string | null; contact_id: number | null }
    | undefined;
  if (!act) return { error: `Activity #${activityId} not found.` };

  // Best-effort structured extraction from the activity's free text.
  let title = act.title || "New job";
  let address = "";
  let scope = act.notes || "";
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        format: "json",
        think: false,
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          {
            role: "system",
            content:
              'From a contractor\'s project note, extract JSON {"title": short job name, "address": site address or "", "scope": 1-3 sentence scope of work}. Use only what\'s in the text; "" if absent.',
          },
          { role: "user", content: `${act.title}\n\n${act.notes || ""}` },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    const m = (j.message?.content || "").match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]) as Record<string, unknown>;
      if (typeof p.title === "string" && p.title.trim()) title = p.title.trim();
      if (typeof p.address === "string") address = p.address.trim();
      if (typeof p.scope === "string" && p.scope.trim()) scope = p.scope.trim();
    }
  } catch {
    /* fall back to raw activity fields */
  }

  const contact = act.contact_id
    ? (db.prepare(`SELECT name FROM contacts WHERE id=?`).get(act.contact_id) as { name: string | null } | undefined)
    : undefined;
  const id = createJob({
    title,
    location: address || null,
    scope,
    contact_id: act.contact_id,
    client: contact?.name || null,
    activity_id: act.id,
    status: "lead",
  });
  return { id };
}

// ---------- Invoices / estimates ----------

export function buildInvoice(
  jobId: number,
  kind: "estimate" | "invoice",
  biller?: BillerKey,
  dueDays = 14,
): Invoice | { error: string } {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(jobId) as Job | undefined;
  if (!job) return { error: `Job #${jobId} not found.` };
  const items = db.prepare(`SELECT * FROM job_line_items WHERE job_id=? ORDER BY sort_order, id`).all(jobId) as LineItem[];

  // If no line items but a quoted price exists, seed a single line so an invoice
  // can still be produced from a simple quote.
  const effItems =
    items.length || !job.quoted_price
      ? items
      : [{ id: 0, job_id: jobId, description: job.title || job.scope || "Work performed", qty: 1, unit_price: job.quoted_price, sort_order: 1 }];
  if (!effItems.length) return { error: "Add at least one line item (or a quoted price) before billing." };

  // No tax (UT, Dallin doesn't charge it): total = subtotal.
  const subtotal = +effItems.reduce((s, i) => s + i.qty * i.unit_price, 0).toFixed(2);
  const billerKey: BillerKey = biller || pickBiller(job);
  const billerName = BUSINESSES[billerKey].name;

  const info = db
    .prepare(
      `INSERT INTO invoices (job_id, kind, status, subtotal, tax_rate, tax, total, issued_on, due_on, items_json, biller, created_at)
       VALUES (?, ?, 'draft', ?, 0, 0, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      jobId,
      kind,
      subtotal,
      subtotal,
      today(),
      kind === "invoice" ? plusDays(dueDays) : null,
      JSON.stringify(effItems.map((i) => ({ description: i.description, qty: i.qty, unit_price: i.unit_price }))),
      billerName,
    );
  const id = Number(info.lastInsertRowid);
  const number = `${kind === "estimate" ? "EST" : "INV"}-${String(id).padStart(4, "0")}`;
  db.prepare(`UPDATE invoices SET number=? WHERE id=?`).run(number, id);
  db.prepare(`UPDATE jobs SET status=?, amount=?, updated_at=datetime('now') WHERE id=?`).run(
    kind === "invoice" ? "invoiced" : "quoted",
    subtotal,
    jobId,
  );
  return db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id) as Invoice;
}

export function getInvoice(id: number): { invoice: Invoice; job: Job; contact: Contact | null } | null {
  const db = getDb();
  const invoice = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(id) as Invoice | undefined;
  if (!invoice) return null;
  const job = db.prepare(`SELECT * FROM jobs WHERE id=?`).get(invoice.job_id) as Job;
  const contact = job.contact_id
    ? (db.prepare(`SELECT id,name,phone,email,address FROM contacts WHERE id=?`).get(job.contact_id) as Contact | undefined) || null
    : null;
  return { invoice, job, contact };
}

// Plain-text rendering used for chat preview AND the SMS body. payUrl, when
// given (a Stripe card-payment link), is appended so the texted invoice is
// pay-by-card in one tap.
export function formatInvoiceText(invoice: Invoice, job: Job, contact: Contact | null, payUrl?: string | null): string {
  const items = (JSON.parse(invoice.items_json || "[]") as { description: string; qty: number; unit_price: number }[]) || [];
  const link = payUrl || invoice.stripe_url;
  const lines = [
    `${invoice.biller || BUSINESSES.tps.name}`,
    `${invoice.kind === "estimate" ? "ESTIMATE" : "INVOICE"} ${invoice.number || ""}`,
    `For: ${contact?.name || job.client || "client"}${job.title ? ` · ${job.title}` : ""}`,
    job.location ? `Site: ${job.location}` : "",
    `Issued: ${invoice.issued_on}${invoice.due_on ? ` · Due: ${invoice.due_on}` : ""}`,
    "",
    ...items.map((i) => `• ${i.description} — ${i.qty} × ${money(i.unit_price)} = ${money(i.qty * i.unit_price)}`),
    "",
    `TOTAL: ${money(invoice.total)}`,
    link && invoice.kind === "invoice" ? `\nPay by card: ${link}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function sendInvoice(invoiceId: number, payUrl?: string | null): Promise<string> {
  const found = getInvoice(invoiceId);
  if (!found) return `Invoice #${invoiceId} not found.`;
  const { invoice, job, contact } = found;
  const phone = contact?.phone;
  if (!phone) return "No phone on the job's primary contact — set one (Contacts) before sending.";
  const body = formatInvoiceText(invoice, job, contact, payUrl);
  const res = await sendSmsViaN8n(phone, body);
  if (!res.ok) return `Couldn't send: ${res.error}`;
  getDb().prepare(`UPDATE invoices SET status='sent', sent_at=datetime('now') WHERE id=?`).run(invoiceId);
  return `${invoice.kind === "estimate" ? "Estimate" : "Invoice"} ${invoice.number} sent to ${contact?.name || phone} (${money(invoice.total)}).`;
}
