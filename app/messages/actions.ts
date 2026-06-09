"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { sendSmsViaN8n } from "@/lib/n8n";

// Delete a conversation. sms_messages cascades via the FK (ON DELETE CASCADE,
// foreign_keys pragma is ON in lib/db.ts).
export async function deleteThread(threadId: number) {
  const db = getDb();
  db.prepare(`DELETE FROM sms_threads WHERE id = ?`).run(threadId);
  revalidatePath("/messages");
  return { ok: true as const };
}

// Start a new conversation: send the first text and record it so the thread
// shows in Messages. Mirrors the chat send_sms recording path.
export async function composeMessage(
  to: string,
  body: string,
): Promise<{ ok: boolean; error?: string; threadId?: number }> {
  const num = to.trim();
  const text = body.trim();
  if (!/^\+\d{7,15}$/.test(num)) return { ok: false, error: "Enter a valid number (E.164, e.g. +18015551234)." };
  if (!text) return { ok: false, error: "Message is empty." };

  const res = await sendSmsViaN8n(num, text);
  if (!res.ok) return { ok: false, error: res.error };

  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO sms_threads (contact_phone, created_at, updated_at)
     VALUES (?, datetime('now'), datetime('now'))`,
  ).run(num);
  const thread = db.prepare(`SELECT id FROM sms_threads WHERE contact_phone = ?`).get(num) as
    | { id: number }
    | undefined;
  if (thread) {
    db.prepare(
      `INSERT INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
       VALUES (?, 'outbound', ?, ?, ?, datetime('now'))`,
    ).run(thread.id, text, res.message_sid ?? null, res.status ?? "queued");
  }
  revalidatePath("/messages");
  return { ok: true, threadId: thread?.id };
}
