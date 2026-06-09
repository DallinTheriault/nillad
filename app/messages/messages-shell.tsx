"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SquarePen, Trash2, Send } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Sheet, Field } from "@/components/sheet";
import { deleteThread, composeMessage } from "./actions";

export type ThreadView = {
  id: number;
  name: string;
  phoneDisplay: string;
  showPhone: boolean;
  preview: string;
  dir: "inbound" | "outbound" | "none";
  unread: boolean;
  stopped: boolean;
  timeAgo: string;
};
export type ContactLite = { name: string; phone: string };

export function MessagesShell({ threads, contacts }: { threads: ThreadView[]; contacts: ContactLite[] }) {
  const [q, setQ] = useState("");
  const [composing, setComposing] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return threads;
    return threads.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        t.phoneDisplay.toLowerCase().includes(s) ||
        t.preview.toLowerCase().includes(s),
    );
  }, [q, threads]);

  function onDelete(id: number, name: string) {
    if (!window.confirm(`Delete conversation with ${name}? This can't be undone.`)) return;
    startTransition(async () => {
      await deleteThread(id);
      router.refresh();
    });
  }

  return (
    <>
      <AutoRefresh intervalMs={5000} />

      <div className="px-4 pt-1 pb-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 rounded-full bg-surface border border-border px-3 focus-within:border-periwinkle">
          <Search size={15} className="text-bone-mute shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages"
            className="w-full bg-transparent py-2 text-sm text-bone placeholder:text-bone-mute outline-none"
          />
        </div>
        <button
          onClick={() => setComposing(true)}
          aria-label="New message"
          className="w-10 h-10 grid place-items-center rounded-full gradient-fill text-bone shrink-0"
        >
          <SquarePen size={18} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-bone-dim font-mono py-10 text-center">
          {q ? "No matches." : "No messages yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((t) => (
            <li key={t.id} className="flex items-stretch">
              <Link
                href={`/messages/${t.id}`}
                className="flex-1 flex items-start gap-3 px-4 py-3.5 min-w-0 active:bg-surface hover:bg-surface/70 transition-colors"
              >
                <span aria-hidden className={`mt-2 inline-block w-2 h-2 rounded-full shrink-0 ${t.unread ? "bg-warmred" : "bg-transparent"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`truncate ${t.unread ? "font-semibold text-bone" : "font-medium text-bone"}`}>{t.name}</span>
                    {t.showPhone && <span className="text-[11px] font-mono text-bone-mute shrink-0">{t.phoneDisplay}</span>}
                    {t.stopped && <span className="text-[10px] uppercase tracking-wider text-warmred shrink-0 font-mono">opted out</span>}
                  </div>
                  <p className="text-sm text-bone-dim truncate">
                    {t.dir === "outbound" && <span className="text-periwinkle">You: </span>}
                    {t.preview || "(no messages)"}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-bone-mute shrink-0 mt-1">{t.timeAgo}</span>
              </Link>
              <button
                onClick={() => onDelete(t.id, t.name)}
                aria-label={`Delete conversation with ${t.name}`}
                className="px-3 grid place-items-center text-bone-mute hover:text-warmred active:text-warmred transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {composing && <Composer contacts={contacts} onClose={() => setComposing(false)} />}
    </>
  );
}

function Composer({ contacts, onClose }: { contacts: ContactLite[]; onClose: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await composeMessage(to, body);
      if (r.ok && r.threadId) {
        router.push(`/messages/${r.threadId}`);
      } else setError(r.error || "Failed to send.");
    });
  }

  return (
    <Sheet title="New message" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {contacts.length > 0 && (
          <Field label="Contact (optional)">
            <select
              onChange={(e) => e.target.value && setTo(e.target.value)}
              defaultValue=""
              className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone outline-none focus:border-periwinkle"
            >
              <option value="">Pick a contact…</option>
              {contacts.map((c) => (
                <option key={c.phone} value={c.phone}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="To">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+18015551234"
            inputMode="tel"
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        <Field label="Message">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={1600}
            placeholder="Type your message"
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle resize-none"
          />
        </Field>
        <div className="flex items-center justify-between pt-2 gap-3">
          <button type="button" onClick={onClose} className="text-bone-dim text-sm hover:text-bone transition">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !to.trim() || !body.trim()}
            className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide inline-flex items-center gap-1.5"
          >
            {pending ? "Sending…" : (<><Send size={14} /> Send</>)}
          </button>
        </div>
        {error && <p className="text-xs text-warmred font-mono text-center">{error}</p>}
      </form>
    </Sheet>
  );
}
