import { NextRequest } from "next/server";
import {
  getStripeConns,
  verifyStripeSignature,
  markInvoicePaidByPaymentLink,
  notifyPaid,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe → us. Public endpoint (Stripe has no session cookie), authenticated by
// the webhook signature instead: we verify the raw body against each connected
// Stripe account's signing secret. On a completed/paid checkout we look up the
// invoice by its originating payment link and mark it (and its job) paid.
//
// Exposed publicly via Tailscale Funnel; middleware lets /api/stripe through.
export async function POST(req: NextRequest): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  // Verify against any configured account's webhook secret.
  const secrets = getStripeConns()
    .map((c) => c.webhookSecret)
    .filter((s): s is string => !!s);
  if (!secrets.length) {
    // No webhook secret stored yet (Dallin hasn't pasted whsec_… after creating
    // the endpoint in Stripe). Reject so Stripe shows it as failing until set up.
    return Response.json({ error: "Webhook not configured." }, { status: 400 });
  }
  const verified = secrets.some((s) => verifyStripeSignature(raw, sig, s));
  if (!verified) {
    return Response.json({ error: "Bad signature." }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON." }, { status: 400 });
  }

  try {
    const type = event.type || "";
    if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
      const session = (event.data?.object || {}) as {
        payment_status?: string;
        payment_link?: string;
        metadata?: { invoice_id?: string };
      };
      // For async payment methods a "completed" session may still be unpaid;
      // only act on a paid session (or the async_payment_succeeded event).
      const isPaid = session.payment_status === "paid" || type === "checkout.session.async_payment_succeeded";
      if (isPaid) {
        const linkId = typeof session.payment_link === "string" ? session.payment_link : "";
        const fallbackId = session.metadata?.invoice_id ? Number(session.metadata.invoice_id) : undefined;
        const ctx = markInvoicePaidByPaymentLink(linkId, fallbackId);
        if (ctx) await notifyPaid(ctx);
      }
    }
  } catch {
    // Never 500 on our own processing — Stripe would retry forever. We verified
    // the signature, so acknowledge receipt regardless.
  }

  return Response.json({ received: true });
}
