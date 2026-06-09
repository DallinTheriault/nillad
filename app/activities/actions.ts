"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

export type ActivityStatus = "active" | "paused" | "done";

function clean(s?: string): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

export async function createActivity(fields: {
  title?: string;
  category?: string;
  notes?: string;
}) {
  const title = clean(fields.title);
  if (!title) return { ok: false as const, error: "Give it a title." };
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO activities (title, category, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))`,
    )
    .run(title, clean(fields.category), clean(fields.notes));
  revalidatePath("/activities");
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

export async function updateActivity(
  id: number,
  fields: { title?: string; category?: string; notes?: string },
) {
  const title = clean(fields.title);
  if (!title) return { ok: false as const, error: "Give it a title." };
  const db = getDb();
  db.prepare(
    `UPDATE activities SET title = ?, category = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(title, clean(fields.category), clean(fields.notes), id);
  revalidatePath("/activities");
  revalidatePath(`/activities/${id}`);
  return { ok: true as const };
}

// Lightweight notes-only save (used by the inline context editor on detail).
export async function saveActivityNotes(id: number, notes: string) {
  const db = getDb();
  db.prepare(
    `UPDATE activities SET notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(clean(notes), id);
  revalidatePath(`/activities/${id}`);
  return { ok: true as const };
}

export async function setActivityStatus(id: number, status: ActivityStatus) {
  const db = getDb();
  db.prepare(
    `UPDATE activities SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(status, id);
  revalidatePath("/activities");
  revalidatePath(`/activities/${id}`);
  return { ok: true as const };
}

export async function archiveActivity(id: number) {
  const db = getDb();
  db.prepare(
    `UPDATE activities SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(id);
  revalidatePath("/activities");
  return { ok: true as const };
}

export async function addTask(activityId: number, title: string) {
  const t = title.trim();
  if (!t) return { ok: false as const, error: "Empty task." };
  const db = getDb();
  const max = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE activity_id = ?`)
    .get(activityId) as { m: number };
  const info = db
    .prepare(
      `INSERT INTO tasks (activity_id, title, done, sort_order, created_at)
       VALUES (?, ?, 0, ?, datetime('now'))`,
    )
    .run(activityId, t, (max.m ?? 0) + 1);
  db.prepare(`UPDATE activities SET updated_at = datetime('now') WHERE id = ?`).run(activityId);
  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/activities");
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

export async function toggleTask(taskId: number, done: boolean) {
  const db = getDb();
  const row = db
    .prepare(`SELECT activity_id FROM tasks WHERE id = ?`)
    .get(taskId) as { activity_id: number } | undefined;
  db.prepare(
    `UPDATE tasks SET done = ?, done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?`,
  ).run(done ? 1 : 0, done ? 1 : 0, taskId);
  if (row) {
    db.prepare(`UPDATE activities SET updated_at = datetime('now') WHERE id = ?`).run(row.activity_id);
    revalidatePath(`/activities/${row.activity_id}`);
  }
  revalidatePath("/activities");
  return { ok: true as const };
}

export async function deleteTask(taskId: number) {
  const db = getDb();
  const row = db
    .prepare(`SELECT activity_id FROM tasks WHERE id = ?`)
    .get(taskId) as { activity_id: number } | undefined;
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  if (row) revalidatePath(`/activities/${row.activity_id}`);
  return { ok: true as const };
}
