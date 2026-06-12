import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { ExpensesShell, type ExpenseRow, type JobOption } from "./expenses-shell";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, vendor, amount, spent_on, category, scope, job_id, notes, photo
       FROM expenses ORDER BY COALESCE(spent_on, created_at) DESC, id DESC LIMIT 300`,
    )
    .all() as ExpenseRow[];

  // Jobs for the optional link dropdown — defensive (jobs schema varies / may be absent).
  let jobs: JobOption[] = [];
  try {
    jobs = db.prepare(`SELECT id, client FROM jobs ORDER BY created_at DESC LIMIT 100`).all() as JobOption[];
  } catch {
    jobs = [];
  }

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Expenses" />
      <ExpensesShell rows={rows} jobs={jobs} />
    </main>
  );
}
