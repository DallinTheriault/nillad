import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

type ActivityRow = {
  id: number;
  title: string;
  category: string | null;
  status: "active" | "paused" | "done";
  notes: string | null;
  updated_at: string | null;
  total: number;
  done_count: number;
};

export default async function ActivitiesPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.category, a.status, a.notes, a.updated_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id) AS total,
              (SELECT COUNT(*) FROM tasks t WHERE t.activity_id = a.id AND t.done = 1) AS done_count
       FROM activities a
       WHERE a.archived_at IS NULL
       ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
                a.updated_at DESC
       LIMIT 200`,
    )
    .all() as ActivityRow[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader
        title="Activities"
        action={
          <Link
            href="/activities/new"
            aria-label="New activity"
            className="w-9 h-9 grid place-items-center rounded-full text-bone hover:bg-surface-2 transition"
          >
            <Plus size={22} />
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <ListChecks size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">No activities yet</div>
          <p className="text-xs text-bone-dim mt-1 max-w-[34ch] mx-auto">
            Track what you’re working on — notes for context, a checklist for the steps.
          </p>
        </div>
      ) : (
        <ul className="px-4 py-4 space-y-2">
          {rows.map((a) => {
            const pct = a.total > 0 ? Math.round((a.done_count / a.total) * 100) : 0;
            return (
              <li key={a.id}>
                <Link
                  href={`/activities/${a.id}`}
                  className="block px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-1 w-1 self-stretch rounded-full"
                      style={{ background: statusSpine(a.status) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium truncate ${a.status === "done" ? "text-bone-mute line-through" : "text-bone"}`}
                        >
                          {a.title}
                        </span>
                        <StatusBadge status={a.status} />
                      </div>
                      {a.notes && (
                        <p className="text-xs text-bone-dim mt-0.5 line-clamp-1">
                          {a.notes}
                        </p>
                      )}
                      {a.total > 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1 flex-1 rounded-full bg-surface-2 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background:
                                  "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-bone-mute shrink-0">
                            {a.done_count}/{a.total}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function statusSpine(status: ActivityRow["status"]): string {
  if (status === "active") return "linear-gradient(180deg, #625CC8 0%, #D52F31 100%)";
  if (status === "paused") return "#3F3A8A";
  return "#2C2C36";
}

function StatusBadge({ status }: { status: ActivityRow["status"] }) {
  const label = status;
  const cls =
    status === "active"
      ? "text-periwinkle"
      : status === "paused"
        ? "text-bone-dim"
        : "text-bone-mute";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-mono shrink-0 ${cls}`}>
      {label}
    </span>
  );
}
