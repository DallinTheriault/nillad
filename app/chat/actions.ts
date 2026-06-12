"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";

export async function createChat(title: string): Promise<{ id: number }> {
  const db = getDb();
  const t = (title || "New chat").trim().slice(0, 80) || "New chat";
  const info = db
    .prepare(
      `INSERT INTO chats (title, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))`,
    )
    .run(t);
  revalidatePath("/chats");
  return { id: Number(info.lastInsertRowid) };
}

export async function appendMessage(
  chatId: number,
  role: "user" | "assistant",
  content: string,
  hasImage = false,
  image: string | null = null,
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO chat_messages (chat_id, role, content, has_image, image, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(chatId, role, content, hasImage ? 1 : 0, image);
  db.prepare(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`).run(chatId);
  revalidatePath("/chats");
  return { ok: true as const };
}

// Overwrite the most recent assistant message in a chat — used by "Retry" so a
// regenerated reply replaces the old one instead of stacking a duplicate.
export async function updateLastAssistant(chatId: number, content: string) {
  const db = getDb();
  db.prepare(
    `UPDATE chat_messages SET content = ?
     WHERE id = (SELECT id FROM chat_messages
                 WHERE chat_id = ? AND role = 'assistant'
                 ORDER BY id DESC LIMIT 1)`,
  ).run(content, chatId);
  db.prepare(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`).run(chatId);
  return { ok: true as const };
}

export async function deleteChat(chatId: number) {
  const db = getDb();
  db.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
  revalidatePath("/chats");
  return { ok: true as const };
}
