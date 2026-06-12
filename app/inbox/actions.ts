"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { toDenverIso } from "@/lib/datetime";
import {
  syncAllMailboxes,
  markEmailSeen,
  archiveEmail,
  deleteEmail,
  moveEmail,
} from "@/lib/email";

// One-tap "remind me to reply" — turns an email into a reminder for tomorrow 9am.
export async function remindAboutEmail(id: number) {
  const db = getDb();
  const row = db
    .prepare(`SELECT from_name, from_addr, subject FROM emails WHERE id=?`)
    .get(id) as { from_name: string | null; from_addr: string | null; subject: string | null } | undefined;
  const who = row?.from_name || row?.from_addr || "someone";
  const text = `Reply to ${who}: ${row?.subject || "(email)"}`.slice(0, 160);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0); // container TZ is America/Denver → 9am MT
  const due = toDenverIso(d);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(`INSERT INTO reminders (text, due_at, status, created_at) VALUES (?, ?, 'pending', ?)`).run(text, due, now);
  revalidatePath("/inbox");
  return { ok: true, msg: "Reminder set for tomorrow 9am." };
}

export async function syncNow() {
  const results = await syncAllMailboxes();
  revalidatePath("/inbox");
  if (!results.length) return { ok: false, error: "No active mailbox. Add one on Connections." };
  const added = results.reduce((n, r) => n + r.added, 0);
  const flagged = results.reduce((n, r) => n + r.flagged, 0);
  const err = results.find((r) => r.error)?.error;
  return { ok: true, added, flagged, error: err };
}

export async function markRead(id: number) {
  const msg = await markEmailSeen(id);
  revalidatePath("/inbox");
  return { ok: true, msg };
}

export async function archive(id: number) {
  const msg = await archiveEmail(id);
  revalidatePath("/inbox");
  return { ok: true, msg };
}

export async function remove(id: number) {
  const msg = await deleteEmail(id);
  revalidatePath("/inbox");
  return { ok: true, msg };
}

export async function move(id: number, folder: string) {
  const msg = await moveEmail(id, folder);
  revalidatePath("/inbox");
  return { ok: true, msg };
}
