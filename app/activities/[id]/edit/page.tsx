import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/lib/db";
import { ActivityForm, type ActivityFormData } from "../../activity-form";

export const dynamic = "force-dynamic";

export default async function EditActivityPage({
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
      `SELECT id, title, category, notes FROM activities
       WHERE id = ? AND archived_at IS NULL`,
    )
    .get(activityId) as ActivityFormData | undefined;
  if (!activity) notFound();

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <header className="border-b border-border bg-bg px-4 py-4">
        <Link
          href={`/activities/${activity.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-bone-dim hover:text-bone mb-2"
        >
          <ArrowLeft size={12} /> Back
        </Link>
        <div className="text-[10px] uppercase tracking-[0.22em] text-bone-mute font-mono mb-1">
          NF · Context
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-bone">
          Edit activity
        </h1>
      </header>

      <div className="px-4 py-4">
        <ActivityForm activity={activity} />
      </div>
    </main>
  );
}
