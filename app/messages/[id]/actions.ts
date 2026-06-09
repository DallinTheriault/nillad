"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { sendSmsViaN8n } from "@/lib/n8n";

export async function sendReply(
  threadId: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "empty body" };
  if (trimmed.length > 1600)
    return { ok: false, error: "body too long (>1600 chars)" };

  const db = getDb();
  const thread = db
    .prepare(
      "SELECT id, contact_phone, consent_status FROM sms_threads WHERE id = ?",
    )
    .get(threadId) as { id: number; contact_phone: string; consent_status: string } | undefined;
  if (!thread) return { ok: false, error: "thread not found" };
  if (thread.consent_status === "stopped")
    return { ok: false, error: "this contact has opted out (STOP)" };

  const r = await sendSmsViaN8n(thread.contact_phone, trimmed);
  if (!r.ok) return { ok: false, error: r.error };

  db.prepare(
    `INSERT INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
     VALUES (?, 'outbound', ?, ?, ?, datetime('now'))`,
  ).run(thread.id, trimmed, r.message_sid ?? null, r.status ?? "queued");

  revalidatePath(`/messages/${threadId}`);
  revalidatePath(`/messages`);
  return { ok: true };
}

// Called from the thread page render (fire-and-forget). Must NOT revalidatePath
// here — that's unsupported during render and throws. The /messages list clears
// the unread badge on its own via AutoRefresh polling + dynamic rendering.
export async function markRead(threadId: number) {
  const db = getDb();
  db.prepare(
    `UPDATE sms_threads SET last_read_at = datetime('now') WHERE id = ?`,
  ).run(threadId);
}
