"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { savePhotoDataUrl } from "@/lib/photos";

export type ExpenseInput = {
  vendor: string;
  amount: number | null;
  spent_on: string;
  category: string;
  scope: string; // business | personal
  job_id: number | null;
  notes: string;
  photoDataUrl?: string | null; // receipt image to save (optional)
  raw?: string | null;
};

const expScope = (s: string | undefined) => (s === "personal" ? "personal" : "business");

export async function addExpense(input: ExpenseInput) {
  const db = getDb();
  let photo: string | null = null;
  if (input.photoDataUrl) {
    try {
      photo = savePhotoDataUrl(`receipt-${input.vendor || "scan"}.jpg`, input.photoDataUrl);
      db.prepare(`INSERT OR IGNORE INTO photos (filename, tags) VALUES (?, 'receipt')`).run(photo);
    } catch {
      /* save image best-effort — still record the expense */
    }
  }
  db.prepare(
    `INSERT INTO expenses (vendor, amount, spent_on, category, scope, job_id, notes, photo, raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    input.vendor.trim() || null,
    input.amount,
    input.spent_on || null,
    input.category || "other",
    expScope(input.scope),
    input.job_id,
    input.notes.trim() || null,
    photo,
    input.raw || null,
  );
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function updateExpense(id: number, fields: Partial<ExpenseInput>) {
  const db = getDb();
  db.prepare(
    `UPDATE expenses SET vendor=?, amount=?, spent_on=?, category=?, scope=?, job_id=?, notes=? WHERE id=?`,
  ).run(
    (fields.vendor ?? "").trim() || null,
    fields.amount ?? null,
    fields.spent_on || null,
    fields.category || "other",
    expScope(fields.scope),
    fields.job_id ?? null,
    (fields.notes ?? "").trim() || null,
    id,
  );
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function deleteExpense(id: number) {
  getDb().prepare(`DELETE FROM expenses WHERE id=?`).run(id);
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  return { ok: true as const };
}
