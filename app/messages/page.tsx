import { MessageSquare } from "lucide-react";
import { getDb } from "@/lib/db";
import { fmtPhoneDisplay } from "@/lib/phone";
import { contactNamesByPhone } from "@/lib/contacts";
import { PageHeader } from "@/components/page-header";
import { MessagesShell, type ThreadView, type ContactLite } from "./messages-shell";

export const dynamic = "force-dynamic";

type ThreadRow = {
  id: number;
  contact_phone: string;
  display_name: string | null;
  consent_status: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_read_at: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso + (iso.includes("T") ? "" : "Z")).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function isUnread(t: ThreadRow): boolean {
  if (!t.last_inbound_at) return false;
  if (!t.last_read_at) return true;
  return new Date(t.last_inbound_at).getTime() > new Date(t.last_read_at).getTime();
}
function lastDirection(t: ThreadRow): "inbound" | "outbound" | "none" {
  const i = t.last_inbound_at ? new Date(t.last_inbound_at).getTime() : 0;
  const o = t.last_outbound_at ? new Date(t.last_outbound_at).getTime() : 0;
  if (i === 0 && o === 0) return "none";
  return o > i ? "outbound" : "inbound";
}

export default async function MessagesPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, contact_phone, display_name, consent_status,
              last_inbound_at, last_outbound_at, last_message_at,
              last_message_preview, last_read_at
       FROM sms_threads WHERE archived_at IS NULL
       ORDER BY last_message_at DESC NULLS LAST LIMIT 200`,
    )
    .all() as ThreadRow[];

  const nameByPhone = contactNamesByPhone(db, rows.map((r) => r.contact_phone));

  const threads: ThreadView[] = rows.map((t) => {
    const phoneDisplay = fmtPhoneDisplay(t.contact_phone);
    const name = nameByPhone.get(t.contact_phone) || t.display_name || phoneDisplay;
    return {
      id: t.id,
      name,
      phoneDisplay,
      showPhone: name !== phoneDisplay,
      preview: t.last_message_preview || "",
      dir: lastDirection(t),
      unread: isUnread(t),
      stopped: t.consent_status === "stopped",
      timeAgo: timeAgo(t.last_message_at),
    };
  });

  const contacts = (
    db
      .prepare(
        `SELECT name, phone FROM contacts
         WHERE archived_at IS NULL AND phone IS NOT NULL AND name IS NOT NULL
         ORDER BY name LIMIT 500`,
      )
      .all() as ContactLite[]
  ).filter((c) => /^\+?\d{7,}$/.test(c.phone.replace(/[\s()-]/g, "")));

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-28">
      <PageHeader title="Messages" />
      {rows.length === 0 ? (
        <>
          <MessagesShell threads={[]} contacts={contacts} />
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
              <MessageSquare size={20} className="text-bone-dim" />
            </div>
            <div className="text-sm font-medium text-bone">No messages yet</div>
            <p className="text-xs text-bone-dim mt-1 max-w-[32ch] mx-auto">
              Tap the compose button to start one, or inbound texts will appear here.
            </p>
          </div>
        </>
      ) : (
        <MessagesShell threads={threads} contacts={contacts} />
      )}
    </main>
  );
}
