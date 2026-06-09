import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, AlertCircle } from "lucide-react";
import { getDb } from "@/lib/db";
import { fmtPhoneDisplay } from "@/lib/phone";
import { contactByPhone } from "@/lib/contacts";
import { ReplyBox } from "./reply-box";
import { markRead } from "./actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { ScrollToBottom } from "@/components/scroll-to-bottom";
export const dynamic = "force-dynamic";

type Thread = {
  id: number;
  contact_phone: string;
  display_name: string | null;
  consent_status: string;
  last_inbound_at: string | null;
  last_read_at: string | null;
};

type Message = {
  id: number;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
  twilio_status: string | null;
  error_code: string | null;
};

function fmtClock(iso: string): string {
  const d = new Date(iso + (iso.includes("T") ? "" : "Z"));
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Friendly outbound status. Twilio's raw lifecycle (queued → sending → sent →
// delivered) is noisy, and without status-callback wiring an outbound row keeps
// its initial "queued" forever — which reads as "stuck" even though the text was
// accepted and delivered. Map to honest labels: anything that left our side reads
// "Sent" (✓), a confirmed "delivered" reads "Delivered" (✓✓ — only if callbacks
// are wired), and only real failures stand out. Returns null for failures (the UI
// renders those separately in red).
function fmtStatus(s: string | null): string | null {
  switch (s) {
    case "failed":
    case "undelivered":
      return null;
    case "sending":
      return "Sending…";
    case "delivered":
      return "Delivered";
    default:
      return "Sent"; // queued, accepted, scheduled, sent, or unknown
  }
}

function sameDay(a: string, b: string): boolean {
  const da = new Date(a + (a.includes("T") ? "" : "Z"));
  const db = new Date(b + (b.includes("T") ? "" : "Z"));
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso + (iso.includes("T") ? "" : "Z"));
  const now = new Date();
  if (sameDay(d.toISOString(), now.toISOString())) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d.toISOString(), yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId)) notFound();

  const db = getDb();
  const thread = db
    .prepare(
      `SELECT id, contact_phone, display_name, consent_status,
              last_inbound_at, last_read_at
       FROM sms_threads WHERE id = ?`,
    )
    .get(threadId) as Thread | undefined;
  if (!thread) notFound();

  const msgs = db
    .prepare(
      `SELECT id, direction, body, created_at, twilio_status, error_code
       FROM sms_messages WHERE thread_id = ?
       ORDER BY created_at ASC`,
    )
    .all(threadId) as Message[];

  if (
    thread.last_inbound_at &&
    (!thread.last_read_at ||
      new Date(thread.last_inbound_at).getTime() >
        new Date(thread.last_read_at).getTime())
  ) {
    void markRead(threadId);
  }

  const contact = contactByPhone(db, thread.contact_phone);
  const displayName =
    contact?.name || thread.display_name || fmtPhoneDisplay(thread.contact_phone);

  return (
    <main className="flex flex-col h-dvh overflow-hidden max-w-2xl mx-auto bg-bg">
      <AutoRefresh intervalMs={4000} />
      <ScrollToBottom dep={msgs.length} />
      <header className="border-b border-border bg-bg shrink-0">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <Link
            href="/messages"
            className="w-8 h-8 grid place-items-center rounded-full active:bg-surface text-bone"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex-1 min-w-0 text-center">
            {contact ? (
              <Link
                href={`/contacts/${contact.id}`}
                className="text-sm font-semibold truncate text-bone hover:underline block"
              >
                {displayName}
              </Link>
            ) : (
              <div className="text-sm font-semibold truncate text-bone">
                {displayName}
              </div>
            )}
            <div className="text-[11px] text-bone-dim font-mono">
              {fmtPhoneDisplay(thread.contact_phone)}
              {thread.consent_status === "stopped" && (
                <span className="ml-2 text-warmred uppercase tracking-wider">
                  · opted out
                </span>
              )}
            </div>
          </div>
          <a
            href={`tel:${thread.contact_phone}`}
            className="w-8 h-8 grid place-items-center rounded-full active:bg-surface text-bone"
            aria-label="Call"
          >
            <Phone size={16} />
          </a>
        </div>
      </header>

      <div id="thread-scroll" className="flex-1 min-h-0 overflow-y-auto px-3 py-4 bg-bg">
        {msgs.length === 0 ? (
          <p className="text-xs text-bone-dim text-center py-8">No messages yet.</p>
        ) : (
          <div className="space-y-2.5">
            {msgs.map((m, i) => {
              const showDayHeader =
                i === 0 || !sameDay(msgs[i - 1].created_at, m.created_at);
              const inbound = m.direction === "inbound";
              const failed =
                !inbound &&
                (m.twilio_status === "failed" ||
                  m.twilio_status === "undelivered");
              return (
                <div key={m.id}>
                  {showDayHeader && (
                    <div className="text-[10px] uppercase tracking-[0.16em] text-bone-mute text-center py-3 font-mono">
                      {fmtDayHeader(m.created_at)}
                    </div>
                  )}
                  <div
                    className={`flex ${inbound ? "justify-start" : "justify-end"} mb-0.5`}
                  >
                    <div className="max-w-[78%] flex flex-col gap-1">
                      <div
                        className={`px-4 py-2.5 rounded-2xl text-[15px] leading-snug whitespace-pre-wrap break-words ${
                          inbound
                            ? "bubble-stroke-muted text-bone"
                            : failed
                              ? "border border-warmred/50 bg-warmred/10 text-bone rounded-2xl"
                              : "bubble-stroke-gradient text-bone"
                        }`}
                      >
                        {m.body}
                      </div>
                      <div
                        className={`text-[10px] font-mono text-bone-mute ${
                          inbound ? "text-left" : "text-right"
                        } px-2`}
                      >
                        {fmtClock(m.created_at)}
                        {!inbound && !failed && fmtStatus(m.twilio_status) && (
                          <span className="ml-1.5">· {fmtStatus(m.twilio_status)}</span>
                        )}
                        {failed && (
                          <span className="text-warmred ml-1.5 inline-flex items-center gap-0.5">
                            <AlertCircle size={10} />
                            {m.error_code ? `failed (${m.error_code})` : "failed"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ReplyBox
        threadId={thread.id}
        isStopped={thread.consent_status === "stopped"}
      />
    </main>
  );
}
