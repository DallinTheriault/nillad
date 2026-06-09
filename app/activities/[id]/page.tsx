import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { getDb } from "@/lib/db";
import { ActivityDetail, type Activity, type Task } from "./activity-detail";

export const dynamic = "force-dynamic";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activityId = Number(id);
  if (!Number.isFinite(activityId)) notFound();

  const db = getDb();
  const activity = db
    .prepare(
      `SELECT id, title, category, status, notes, created_at, updated_at
       FROM activities WHERE id = ? AND archived_at IS NULL`,
    )
    .get(activityId) as Activity | undefined;
  if (!activity) notFound();

  const tasks = db
    .prepare(
      `SELECT id, title, done, done_at FROM tasks
       WHERE activity_id = ?
       ORDER BY done ASC, sort_order ASC, id ASC`,
    )
    .all(activityId) as Task[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href="/activities"
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Activities
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
              NF · Context{activity.category ? ` · ${activity.category}` : ""}
            </div>
            <h1
              className={`text-2xl font-semibold tracking-tight truncate ${
                activity.status === "done" ? "text-bone-mute line-through" : "text-bone"
              }`}
            >
              {activity.title}
            </h1>
          </div>
          <Link
            href={`/activities/${activity.id}/edit`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-bone-dim hover:text-bone hover:border-border-strong text-xs transition shrink-0"
          >
            <Pencil size={12} /> Edit
          </Link>
        </div>
      </header>

      <ActivityDetail activity={activity} tasks={tasks} />
    </main>
  );
}
