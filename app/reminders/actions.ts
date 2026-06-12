"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { denverInputToIso } from "@/lib/datetime";
import { createGeoReminder, deleteGeoReminder } from "@/lib/geo";

// The n8n dispatcher polls /vault/nillad.db every minute and ships pending rows
// whose due_at <= now. So inserting/updating directly here is the full integration.
//
// `dueLocal` is a datetime-local picker value ("YYYY-MM-DDTHH:MM") = Denver
// wall-clock. We normalize it to a Denver-offset ISO so it's stored identically
// to chat-created reminders and fires at the right instant (see lib/datetime.ts).

export async function createReminder(text: string, dueLocal: string) {
  const t = text.trim();
  if (!t) return { ok: false, error: "Empty reminder text." };
  if (!dueLocal) return { ok: false, error: "Pick a due time." };
  let dueIso: string;
  try {
    dueIso = denverInputToIso(dueLocal);
  } catch {
    return { ok: false, error: "Couldn’t read that date/time." };
  }
  const db = getDb();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `INSERT INTO reminders (text, due_at, status, created_at) VALUES (?, ?, 'pending', ?)`,
  ).run(t, dueIso, now);
  revalidatePath("/reminders");
  return { ok: true };
}

export async function updateReminder(
  id: number,
  fields: { text?: string; due_local?: string },
) {
  const db = getDb();
  if (fields.text !== undefined) {
    db.prepare("UPDATE reminders SET text = ? WHERE id = ?").run(
      fields.text.trim(),
      id,
    );
  }
  if (fields.due_local !== undefined) {
    let dueIso: string;
    try {
      dueIso = denverInputToIso(fields.due_local);
    } catch {
      return { ok: false, error: "Couldn’t read that date/time." };
    }
    db.prepare("UPDATE reminders SET due_at = ? WHERE id = ?").run(dueIso, id);
  }
  revalidatePath("/reminders");
  return { ok: true };
}

export async function cancelReminder(id: number) {
  const db = getDb();
  db.prepare(
    `UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
  ).run(id);
  revalidatePath("/reminders");
  return { ok: true };
}

export async function reactivateReminder(id: number) {
  const db = getDb();
  db.prepare(
    `UPDATE reminders SET status = 'pending' WHERE id = ? AND status = 'cancelled'`,
  ).run(id);
  revalidatePath("/reminders");
  return { ok: true };
}

// ---- Location reminders ----
export async function addGeoReminder(place: string, text: string, repeat: boolean) {
  try {
    createGeoReminder(place, text, repeat);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn’t save." };
  }
  revalidatePath("/reminders");
  return { ok: true };
}

export async function removeGeoReminder(id: number) {
  deleteGeoReminder(id);
  revalidatePath("/reminders");
  return { ok: true };
}
