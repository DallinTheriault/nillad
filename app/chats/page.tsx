import Link from "next/link";
import { MessageCircle, Plus } from "lucide-react";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

type ChatRow = {
  id: number;
  title: string | null;
  updated_at: string;
  preview: string | null;
  msgs: number;
};

function timeAgo(iso: string): string {
  const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ChatsPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.updated_at,
              (SELECT content FROM chat_messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) AS preview,
              (SELECT COUNT(*) FROM chat_messages WHERE chat_id = c.id) AS msgs
       FROM chats c
       ORDER BY c.updated_at DESC
       LIMIT 200`,
    )
    .all() as ChatRow[];

  const visible = rows.filter((r) => r.msgs > 0);

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-28">
      <PageHeader
        title="Chats"
        action={
          <Link
            href="/chat"
            aria-label="New chat"
            className="w-9 h-9 grid place-items-center rounded-full text-bone hover:bg-surface-2 transition"
          >
            <Plus size={22} />
          </Link>
        }
      />

      {visible.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <MessageCircle size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">No chats yet</div>
          <p className="text-xs text-bone-dim mt-1">Start one from the bar on any screen.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="flex items-start gap-3 px-4 py-3.5 active:bg-surface hover:bg-surface/70 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-bone truncate">{c.title || "Chat"}</span>
                    <span className="text-[11px] font-mono text-bone-mute shrink-0">
                      {timeAgo(c.updated_at)}
                    </span>
                  </div>
                  <p className="text-sm text-bone-dim truncate mt-0.5">
                    {c.preview === "[image]" ? "📎 image" : c.preview || "…"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
