// Stripe pay-by-card: turn an invoice into a hosted Payment Link (card checkout)
// and auto-mark it paid when Stripe calls the webhook. Local-first / dependency-
// free: we hit Stripe's REST API with raw fetch (form-encoded, Bearer key) and
// verify the webhook signature with node crypto — no `stripe` npm package, same
// minimalist style as the rest of the stack.
//
// Keys live in the Connections registry (provider='stripe'), one per business
// (TPS / Sharpline), each with an api_key and (once Dallin sets up the webhook
// endpoint in Stripe) a webhook_secret. Nothing leaves the box except the calls
// to Stripe itself.

import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getInvoice, businessFor, setPaid, type BillerKey } from "@/lib/jobs";
import { pushNtfy } from "@/lib/notify";

const STRIPE_API = "https://api.stripe.com";

export type StripeConn = {
  id: number;
  billerKey: BillerKey;
  apiKey: string;
  webhookSecret: string | null;
  label: string;
};

// All registered Stripe accounts, decoded. Each connection's biller is taken
// from config.biller, else inferred from the label ("Sharpline" → sharpline),
// else defaults to tps (the original key #4 predates the biller field).
export function getStripeConns(): StripeConn[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, label, config, secret FROM connections
       WHERE provider='stripe' AND status!='disabled'`,
    )
    .all() as { id: number; label: string; config: string | null; secret: string | null }[];
  const out: StripeConn[] = [];
  for (const r of rows) {
    try {
      const cfg = r.config ? (JSON.parse(r.config) as Record<string, string>) : {};
      const sec = r.secret ? (JSON.parse(r.secret) as Record<string, string>) : {};
      const apiKey = sec.api_key || sec.secret_value || "";
      if (!apiKey) continue;
      const hint = `${cfg.biller || ""} ${r.label || ""}`.toLowerCase();
      const billerKey: BillerKey = hint.includes("sharpline") ? "sharpline" : "tps";
      out.push({
        id: r.id,
        billerKey,
        apiKey,
        webhookSecret: sec.webhook_secret || null,
        label: r.label,
      });
    } catch {
      /* skip a malformed connection */
    }
  }
  return out;
}

// The Stripe account that bills for a given business, falling back to any
// configured account (so a single-account setup still works for both billers).
export function stripeConnForBiller(billerKey: BillerKey): StripeConn | null {
  const conns = getStripeConns();
  return conns.find((c) => c.billerKey === billerKey) || conns[0] || null;
}

// POST form-encoded to Stripe; throws with Stripe's own error message on non-2xx
// so the UI can show "your restricted key can't write Payment Links", etc.
async function stripePost(
  apiKey: string,
  path: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(form).toString();
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message || `Stripe ${res.status}`;
    throw new Error(err);
  }
  return json;
}

// Create (or return the existing) hosted card-payment link for an invoice.
// Idempotent: once an invoice has a stripe_url we return it unchanged.
export async function createInvoicePaymentLink(
  invoiceId: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const db = getDb();
  const found = getInvoice(invoiceId);
  if (!found) return { ok: false, error: `Invoice #${invoiceId} not found.` };
  const { invoice, job } = found;

  // Already minted? hand it back.
  const existing = (invoice as { stripe_url?: string | null }).stripe_url;
  if (existing) return { ok: true, url: existing };

  if (invoice.kind !== "invoice") return { ok: false, error: "Payment links are for invoices, not estimates." };
  if (!invoice.total || invoice.total <= 0) return { ok: false, error: "Invoice total is $0 — nothing to charge." };

  const biz = businessFor(invoice.biller);
  const conn = stripeConnForBiller(biz.key);
  if (!conn) return { ok: false, error: "No Stripe account connected. Add one on /connections (provider Stripe)." };

  const cents = Math.round(invoice.total * 100);
  try {
    // 1) A one-off price (creates an inline product named after the invoice).
    const price = await stripePost(conn.apiKey, "/v1/prices", {
      currency: "usd",
      unit_amount: String(cents),
      "product_data[name]": `${biz.name} — ${invoice.number || `Invoice ${invoiceId}`}`,
    });
    const priceId = String(price.id || "");
    if (!priceId) return { ok: false, error: "Stripe didn't return a price id." };

    // 2) The payment link (never expires). We match session.payment_link back to
    //    this id in the webhook; metadata is a belt-and-suspenders fallback.
    const link = await stripePost(conn.apiKey, "/v1/payment_links", {
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "metadata[invoice_id]": String(invoiceId),
      "metadata[number]": invoice.number || "",
    });
    const linkId = String(link.id || "");
    const url = String(link.url || "");
    if (!url) return { ok: false, error: "Stripe didn't return a payment URL." };

    db.prepare(`UPDATE invoices SET stripe_payment_link_id=?, stripe_url=? WHERE id=?`).run(
      linkId,
      url,
      invoiceId,
    );
    void job; // (kept for clarity; biller already resolved above)
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Verify a Stripe webhook signature (the `Stripe-Signature` header) against a
// signing secret. Mirrors Stripe's scheme: HMAC-SHA256 of `${t}.${payload}`,
// compared to the v1 signature, with a generous timestamp tolerance.
export function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // 10-minute tolerance against replay.
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 600) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

// Mark the invoice (and its job) paid from a completed Stripe checkout, matched
// by the originating payment link id. Returns context for the ntfy push.
export function markInvoicePaidByPaymentLink(
  paymentLinkId: string,
  fallbackInvoiceId?: number,
): { invoiceNumber: string; total: number; jobTitle: string | null } | null {
  const db = getDb();
  let row = paymentLinkId
    ? (db
        .prepare(`SELECT id, job_id, number, total, status FROM invoices WHERE stripe_payment_link_id=?`)
        .get(paymentLinkId) as { id: number; job_id: number; number: string | null; total: number; status: string } | undefined)
    : undefined;
  if (!row && fallbackInvoiceId) {
    row = db
      .prepare(`SELECT id, job_id, number, total, status FROM invoices WHERE id=?`)
      .get(fallbackInvoiceId) as typeof row;
  }
  if (!row) return null;

  db.prepare(`UPDATE invoices SET status='paid', paid_at=datetime('now') WHERE id=?`).run(row.id);
  // Flip the job to paid too (also marks any sibling invoices paid).
  setPaid(row.job_id, true);
  const job = db.prepare(`SELECT title FROM jobs WHERE id=?`).get(row.job_id) as { title: string | null } | undefined;
  return { invoiceNumber: row.number || `#${row.id}`, total: row.total, jobTitle: job?.title || null };
}

// Push a "you got paid" ntfy. Best-effort.
export async function notifyPaid(ctx: { invoiceNumber: string; total: number; jobTitle: string | null }): Promise<void> {
  await pushNtfy(
    "nillad-payment",
    "💳 Payment received",
    `${ctx.invoiceNumber} paid — $${ctx.total.toFixed(2)}${ctx.jobTitle ? ` · ${ctx.jobTitle}` : ""}`,
    { priority: 4, tags: "moneybag" },
  );
}
