import { Mail } from "lucide-react";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { InboxShell, type EmailRow } from "./inbox-shell";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const db = getDb();

  // Are there any active mailboxes at all? (drives the empty-state copy)
  const mailboxes = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM connections WHERE provider='imap' AND status='active'`)
      .get() as { n: number }
  ).n;

  const rows = db
    .prepare(
      `SELECT e.id, e.from_name, e.from_addr, e.subject, e.date, e.summary, e.snippet,
              e.importance, e.important, e.seen, e.reason, c.label AS mailbox
       FROM emails e JOIN connections c ON c.id = e.connection_id
       WHERE e.archived = 0
       ORDER BY e.date DESC LIMIT 150`,
    )
    .all() as EmailRow[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Inbox" />

      {mailboxes === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <Mail size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">No mailbox connected</div>
          <p className="text-xs text-bone-dim mt-1 max-w-[34ch] mx-auto">
            Add an IMAP mailbox on the Connections page (Gmail works with an app password), then
            tap Sync.
          </p>
        </div>
      ) : (
        <InboxShell rows={rows} />
      )}
    </main>
  );
}
