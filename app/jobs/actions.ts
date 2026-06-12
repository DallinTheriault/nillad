"use server";

import { revalidatePath } from "next/cache";
import {
  createJob,
  updateJob,
  setPaid,
  addLineItem,
  updateLineItem,
  deleteLineItem,
  createJobFromActivity,
  buildInvoice,
  sendInvoice,
  type Job,
} from "@/lib/jobs";
import { createInvoicePaymentLink } from "@/lib/stripe";

export async function createJobAction(fields: Partial<Job>) {
  const id = createJob(fields);
  revalidatePath("/jobs");
  return { ok: true, id };
}

export async function createFromActivityAction(activityId: number) {
  const r = await createJobFromActivity(activityId);
  revalidatePath("/jobs");
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

export async function updateJobAction(id: number, fields: Partial<Job>) {
  updateJob(id, fields);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function setPaidAction(id: number, paid: boolean) {
  setPaid(id, paid);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/jobs");
  return { ok: true };
}

export async function addItemAction(jobId: number, description: string, qty: number, unitPrice: number) {
  addLineItem(jobId, description, qty, unitPrice);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function updateItemAction(jobId: number, id: number, f: { description?: string; qty?: number; unit_price?: number }) {
  updateLineItem(id, f);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}
export async function deleteItemAction(jobId: number, id: number) {
  deleteLineItem(id);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

export async function createInvoiceAction(
  jobId: number,
  kind: "estimate" | "invoice",
  biller?: "tps" | "sharpline",
) {
  const r = buildInvoice(jobId, kind, biller);
  revalidatePath(`/jobs/${jobId}`);
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

export async function sendInvoiceAction(jobId: number, invoiceId: number) {
  // For invoices (not estimates), mint/return a card-payment link so the text
  // is pay-by-card in one tap. Best-effort: if Stripe isn't set up, we still
  // send the invoice text without a link.
  const link = await createInvoicePaymentLink(invoiceId);
  const payUrl = link.ok ? link.url : undefined;
  const msg = await sendInvoice(invoiceId, payUrl);
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, msg, payUrl, payErr: link.ok ? undefined : link.error };
}

// Mint (or return) the Stripe card-payment link for an invoice, without texting.
export async function createPaymentLinkAction(jobId: number, invoiceId: number) {
  const r = await createInvoicePaymentLink(invoiceId);
  revalidatePath(`/jobs/${jobId}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, url: r.url };
}
