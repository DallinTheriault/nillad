"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { deletePhotoFile } from "@/lib/photos";

export async function deletePhoto(name: string) {
  const ok = deletePhotoFile(name);
  if (ok) getDb().prepare(`DELETE FROM photos WHERE filename = ?`).run(name);
  revalidatePath("/gallery");
  return { ok };
}

export async function updatePhotoMeta(name: string, caption: string, tags: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO photos (filename, caption, tags) VALUES (?, ?, ?)
     ON CONFLICT(filename) DO UPDATE SET caption = excluded.caption, tags = excluded.tags`,
  ).run(name, caption.trim() || null, tags.trim() || null);
  revalidatePath("/gallery");
  return { ok: true };
}
