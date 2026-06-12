// Business dashboard — turns the data Nillad already captures (jobs, invoices,
// expenses) into at-a-glance numbers: money in, money owed (with aging), spend,
// and the jobs pipeline. Read-only + fully defensive (every query try/caught) so a
// sparse/empty table just shows zeros instead of erroring.

import { getDb } from "@/lib/db";
import { monthlyBurn } from "@/lib/subscriptions";

function q<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export type AgingBucket = { label: string; amount: number; count: number };
export type PipelineStage = { status: string; count: number; value: number };
export type ExpenseCat = { category: string; amount: number };
export type UnpaidRow = { number: string; total: number; days: number; job: string };

export type Dashboard = {
  revenueMtd: number;
  revenueAll: number;
  owedTotal: number;
  owedCount: number;
  aging: AgingBucket[];
  expensesMtd: number;
  netMtd: number;
  recurringMonthly: number;
  pipeline: PipelineStage[];
  expenseCats: ExpenseCat[];
  unpaid: UnpaidRow[];
};

// Per-job revenue value: prefer the latest invoice total, else the quote, else amount.
const JOB_VALUE = `COALESCE(
  (SELECT i.total FROM invoices i WHERE i.job_id = j.id ORDER BY i.created_at DESC LIMIT 1),
  j.quoted_price, j.amount, 0)`;

export function getDashboard(): Dashboard {
  const db = getDb();

  const revenueMtd = q(
    () =>
      (db
        .prepare(
          `SELECT COALESCE(SUM(${JOB_VALUE}), 0) AS v FROM jobs j
           WHERE COALESCE(j.paid,0)=1 AND j.paid_at IS NOT NULL
             AND date(j.paid_at) >= date('now','localtime','start of month')`,
        )
        .get() as { v: number }).v,
    0,
  );

  const revenueAll = q(
    () =>
      (db
        .prepare(`SELECT COALESCE(SUM(${JOB_VALUE}),0) AS v FROM jobs j WHERE COALESCE(j.paid,0)=1`)
        .get() as { v: number }).v,
    0,
  );

  const owed = q(
    () =>
      db
        .prepare(
          `SELECT i.number, i.total, i.sent_at, COALESCE(j.title,j.client,'job') AS job
           FROM invoices i LEFT JOIN jobs j ON j.id=i.job_id
           WHERE i.status='sent' ORDER BY i.sent_at ASC`,
        )
        .all() as { number: string; total: number; sent_at: string | null; job: string }[],
    [],
  );
  const owedTotal = owed.reduce((s, r) => s + (r.total || 0), 0);
  const now = Date.now();
  const daysSince = (iso: string | null) => (iso ? Math.floor((now - Date.parse(iso)) / 86400000) : 0);
  const buckets: AgingBucket[] = [
    { label: "0–7 days", amount: 0, count: 0 },
    { label: "8–30 days", amount: 0, count: 0 },
    { label: "30+ days", amount: 0, count: 0 },
  ];
  for (const r of owed) {
    const d = daysSince(r.sent_at);
    const b = d <= 7 ? buckets[0] : d <= 30 ? buckets[1] : buckets[2];
    b.amount += r.total || 0;
    b.count += 1;
  }
  const unpaid: UnpaidRow[] = owed
    .map((r) => ({ number: r.number, total: r.total, days: daysSince(r.sent_at), job: r.job }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 8);

  const expensesMtd = q(
    () =>
      (db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS v FROM expenses
           WHERE date(COALESCE(spent_on, created_at)) >= date('now','localtime','start of month')
             AND (scope='business' OR scope IS NULL)`,
        )
        .get() as { v: number }).v,
    0,
  );

  const expenseCats = q(
    () =>
      db
        .prepare(
          `SELECT COALESCE(category,'other') AS category, COALESCE(SUM(amount),0) AS amount
           FROM expenses
           WHERE date(COALESCE(spent_on, created_at)) >= date('now','localtime','start of month')
             AND (scope='business' OR scope IS NULL)
           GROUP BY COALESCE(category,'other') ORDER BY amount DESC LIMIT 6`,
        )
        .all() as ExpenseCat[],
    [],
  );

  // Pipeline value uses a plain column expression (a correlated subquery inside a
  // grouped SUM errors in SQLite) — quote/amount is the right signal for open jobs.
  const pipeline = q(
    () =>
      db
        .prepare(
          `SELECT COALESCE(status,'lead') AS status, COUNT(*) AS count,
                  COALESCE(SUM(COALESCE(quoted_price, amount, 0)),0) AS value
           FROM jobs WHERE COALESCE(paid,0)=0
           GROUP BY COALESCE(status,'lead')`,
        )
        .all() as PipelineStage[],
    [],
  );
  // Order pipeline stages logically.
  const ORDER = ["lead", "quoted", "scheduled", "active", "done", "invoiced"];
  pipeline.sort((a, b) => {
    const ai = ORDER.indexOf(a.status);
    const bi = ORDER.indexOf(b.status);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  return {
    revenueMtd,
    revenueAll,
    owedTotal,
    owedCount: owed.length,
    aging: buckets,
    expensesMtd,
    netMtd: revenueMtd - expensesMtd,
    recurringMonthly: monthlyBurn("business"),
    pipeline,
    expenseCats,
    unpaid,
  };
}
