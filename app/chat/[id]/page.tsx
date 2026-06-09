import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { ChatView } from "../chat-view";

export const dynamic = "force-dynamic";

type Row = {
  role: "user" | "assistant";
  content: string;
  has_image: number;
  image: string | null;
};

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const chatId = Number(id);
  if (!Number.isFinite(chatId)) notFound();

  const db = getDb();
  const chat = db.prepare(`SELECT id FROM chats WHERE id = ?`).get(chatId);
  if (!chat) notFound();

  const rows = db
    .prepare(
      `SELECT role, content, has_image, image FROM chat_messages WHERE chat_id = ? ORDER BY id ASC`,
    )
    .all(chatId) as Row[];

  const messages = rows.map((r) => ({
    role: r.role,
    content: r.content === "[image]" ? "" : r.content,
    hasImage: r.has_image === 1,
    // Persisted data URL → the original image renders on resume (not just a marker).
    image: r.image ?? undefined,
  }));

  return <ChatView chatId={chatId} initialMessages={messages} />;
}
