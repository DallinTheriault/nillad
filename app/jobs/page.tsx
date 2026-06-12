import { getDb } from "@/lib/db";
import { listJobs } from "@/lib/jobs";
import { PageHeader } from "@/components/page-header";
import { JobsShell, type JobListRow, type ActivityOption } from "./jobs-shell";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const rows = listJobs() as JobListRow[];
  const db = getDb();
  const activities = db
    .prepare(`SELECT id, title FROM activities WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 50`)
    .all() as ActivityOption[];

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Jobs" />
      <JobsShell rows={rows} activities={activities} />
    </main>
  );
}
