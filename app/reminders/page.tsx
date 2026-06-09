import { Bell } from "lucide-react";
import { getDb } from "@/lib/db";
import { RemindersShell, type ReminderRow } from "./reminders-shell";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, text, due_at, status, created_at
       FROM reminders
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END,
         due_at ASC
       LIMIT 200`,
    )
    .all() as ReminderRow[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Reminders" />

      {rows.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <Bell size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">No reminders</div>
          <p className="text-xs text-bone-dim mt-1 max-w-[32ch] mx-auto">
            Set one from Nillad chat, or use the + button below.
          </p>
        </div>
      ) : (
        <RemindersShell rows={rows} />
      )}
    </main>
  );
}
