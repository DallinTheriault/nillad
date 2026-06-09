"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { denverInputToIso } from "@/lib/datetime";

// Calendar events live in nillad.db (local-first, $0). Times come from
// datetime-local pickers as Denver wall-clock and are normalized to Denver-offset
// ISO, matching reminders so the calendar stays timezone-correct.

export async function createEvent(fields: {
  title?: string;
  start_local?: string;
  end_local?: string;
  location?: string;
  description?: string;
}) {
  const title = (fields.title ?? "").trim();
  if (!title) return { ok: false as const, error: "Give it a title." };
  if (!fields.start_local) return { ok: false as const, error: "Pick a start time." };
  let startIso: string;
  let endIso: string | null = null;
  try {
    startIso = denverInputToIso(fields.start_local);
    if (fields.end_local) endIso = denverInputToIso(fields.end_local);
  } catch {
    return { ok: false as const, error: "Couldn’t read that date/time." };
  }
  if (endIso && endIso < startIso) return { ok: false as const, error: "End is before start." };
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO calendar_events (title, start_at, end_at, location, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(title, startIso, endIso, (fields.location ?? "").trim() || null, (fields.description ?? "").trim() || null);
  revalidatePath("/calendar");
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

export async function updateEvent(
  id: number,
  fields: { title?: string; start_local?: string; end_local?: string; location?: string; description?: string },
) {
  const title = (fields.title ?? "").trim();
  if (!title) return { ok: false as const, error: "Give it a title." };
  if (!fields.start_local) return { ok: false as const, error: "Pick a start time." };
  let startIso: string;
  let endIso: string | null = null;
  try {
    startIso = denverInputToIso(fields.start_local);
    if (fields.end_local) endIso = denverInputToIso(fields.end_local);
  } catch {
    return { ok: false as const, error: "Couldn’t read that date/time." };
  }
  if (endIso && endIso < startIso) return { ok: false as const, error: "End is before start." };
  const db = getDb();
  db.prepare(
    `UPDATE calendar_events
       SET title=?, start_at=?, end_at=?, location=?, description=?, updated_at=datetime('now')
     WHERE id=?`,
  ).run(title, startIso, endIso, (fields.location ?? "").trim() || null, (fields.description ?? "").trim() || null, id);
  revalidatePath("/calendar");
  return { ok: true as const };
}

export async function cancelEvent(id: number) {
  const db = getDb();
  db.prepare(`UPDATE calendar_events SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id);
  revalidatePath("/calendar");
  return { ok: true as const };
}
