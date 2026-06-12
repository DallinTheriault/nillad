"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

export type SubscriptionInput = {
  name: string;
  vendor: string;
  amount: number | null;
  cadence: string;
  category: string;
  scope: string;
  next_renewal: string;
  notes: string;
};

const scopeOf = (s: string | undefined) => (s === "personal" ? "personal" : "business");

export async function addSubscription(input: SubscriptionInput) {
  getDb()
    .prepare(
      `INSERT INTO subscriptions (name, vendor, amount, cadence, category, scope, next_renewal, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    )
    .run(
      input.name.trim() || "Untitled",
      input.vendor.trim() || null,
      input.amount ?? 0,
      input.cadence || "monthly",
      input.category || "other",
      scopeOf(input.scope),
      input.next_renewal || null,
      input.notes.trim() || null,
    );
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/finances");
  return { ok: true as const };
}

export async function updateSubscription(id: number, fields: Partial<SubscriptionInput>) {
  getDb()
    .prepare(
      `UPDATE subscriptions SET name=?, vendor=?, amount=?, cadence=?, category=?, scope=?, next_renewal=?, notes=?, updated_at=datetime('now') WHERE id=?`,
    )
    .run(
      (fields.name ?? "").trim() || "Untitled",
      (fields.vendor ?? "").trim() || null,
      fields.amount ?? 0,
      fields.cadence || "monthly",
      fields.category || "other",
      scopeOf(fields.scope),
      fields.next_renewal || null,
      (fields.notes ?? "").trim() || null,
      id,
    );
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  revalidatePath("/finances");
  return { ok: true as const };
}

export async function setSubscriptionActive(id: number, active: boolean) {
  getDb()
    .prepare(`UPDATE subscriptions SET active=?, updated_at=datetime('now') WHERE id=?`)
    .run(active ? 1 : 0, id);
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function deleteSubscription(id: number) {
  getDb().prepare(`DELETE FROM subscriptions WHERE id=?`).run(id);
  revalidatePath("/subscriptions");
  revalidatePath("/dashboard");
  return { ok: true as const };
}
