// Personal finances engine — the counterpart to the BUSINESS dashboard, kept
// strictly separate. Manual entry only (no bank connection): income, debts,
// bills, savings goals. From those it computes a live budget, a debt-payoff
// simulation (avalanche vs snowball), and savings-goal feasibility — the numbers
// the planner narrates into a game plan. All math is deterministic here; the LLM
// only phrases it (never computes), so the advice is trustworthy.

import { getDb } from "@/lib/db";
import { listSubscriptions, monthlyEquivalent as subMonthly } from "@/lib/subscriptions";

// Cadence → monthly-equivalent multiplier. Superset covering income + bills.
export const FIN_CADENCES = ["once", "weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"] as const;
export type FinCadence = (typeof FIN_CADENCES)[number];

export function monthlyOf(amount: number, cadence: string): number {
  const a = amount || 0;
  switch (cadence) {
    case "once":
      return 0; // one-off, not part of recurring monthly baseline
    case "weekly":
      return (a * 52) / 12;
    case "biweekly":
      return (a * 26) / 12;
    case "semimonthly":
      return a * 2;
    case "quarterly":
      return a / 3;
    case "yearly":
      return a / 12;
    case "monthly":
    default:
      return a;
  }
}

export const DEBT_KINDS = ["credit_card", "auto", "student", "personal", "medical", "other"] as const;
export const BILL_CATEGORIES = [
  "housing", "utilities", "groceries", "transport", "insurance", "phone", "childcare", "medical", "other",
] as const;

export type Income = {
  id: number; person: string | null; source: string | null; amount: number;
  cadence: string; received_on: string | null; active: number; notes: string | null;
};
export type Debt = {
  id: number; name: string; kind: string | null; balance: number; apr: number;
  min_payment: number; due_day: number | null; active: number; notes: string | null;
};
export type Bill = {
  id: number; name: string; amount: number; cadence: string;
  category: string | null; due_day: number | null; active: number; notes: string | null;
};
export type Goal = {
  id: number; name: string; target_amount: number; target_date: string | null;
  saved_amount: number; strategy: string | null; status: string; plan: string | null; activity_id: number | null;
};

export function listIncome(): Income[] {
  return getDb().prepare(`SELECT * FROM finance_income ORDER BY active DESC, person, id`).all() as Income[];
}
export function listDebts(): Debt[] {
  return getDb().prepare(`SELECT * FROM finance_debts ORDER BY active DESC, balance DESC`).all() as Debt[];
}
export function listBills(): Bill[] {
  return getDb().prepare(`SELECT * FROM finance_bills ORDER BY active DESC, amount DESC`).all() as Bill[];
}
export function listGoals(): Goal[] {
  return getDb().prepare(`SELECT * FROM finance_goals WHERE status!='archived' ORDER BY status, target_date`).all() as Goal[];
}

export type FinanceSummary = {
  monthlyIncome: number;
  incomeByPerson: { person: string; monthly: number }[];
  monthlyBills: number;
  monthlySubs: number; // personal subscriptions
  monthlyDebtMin: number;
  monthlyObligations: number;
  freeCashflow: number;
  totalDebt: number;
  totalSaved: number;
  billsByCategory: { category: string; monthly: number }[];
  debtCount: number;
  weightedApr: number; // balance-weighted average APR
};

export function getFinanceSummary(): FinanceSummary {
  const income = listIncome().filter((i) => i.active);
  const debts = listDebts().filter((d) => d.active);
  const bills = listBills().filter((b) => b.active);
  const subs = listSubscriptions(true).filter((s) => (s as { scope?: string }).scope === "personal");

  const monthlyIncome = income.reduce((s, i) => s + monthlyOf(i.amount, i.cadence), 0);
  const byPerson = new Map<string, number>();
  for (const i of income) {
    const p = (i.person || "—").trim() || "—";
    byPerson.set(p, (byPerson.get(p) || 0) + monthlyOf(i.amount, i.cadence));
  }

  const monthlyBills = bills.reduce((s, b) => s + monthlyOf(b.amount, b.cadence), 0);
  const monthlySubs = subs.reduce((s, x) => s + subMonthly(x.amount, x.cadence), 0);
  const monthlyDebtMin = debts.reduce((s, d) => s + (d.min_payment || 0), 0);
  const totalDebt = debts.reduce((s, d) => s + (d.balance || 0), 0);

  const billCat = new Map<string, number>();
  for (const b of bills) {
    const c = b.category || "other";
    billCat.set(c, (billCat.get(c) || 0) + monthlyOf(b.amount, b.cadence));
  }
  if (monthlySubs > 0) billCat.set("subscriptions", (billCat.get("subscriptions") || 0) + monthlySubs);

  const weightedApr = totalDebt > 0 ? debts.reduce((s, d) => s + (d.balance || 0) * (d.apr || 0), 0) / totalDebt : 0;
  const monthlyObligations = monthlyBills + monthlySubs + monthlyDebtMin;
  const saved = listGoals().filter((g) => g.status === "active").reduce((s, g) => s + (g.saved_amount || 0), 0);

  return {
    monthlyIncome: +monthlyIncome.toFixed(2),
    incomeByPerson: [...byPerson.entries()].map(([person, monthly]) => ({ person, monthly: +monthly.toFixed(2) })),
    monthlyBills: +monthlyBills.toFixed(2),
    monthlySubs: +monthlySubs.toFixed(2),
    monthlyDebtMin: +monthlyDebtMin.toFixed(2),
    monthlyObligations: +monthlyObligations.toFixed(2),
    freeCashflow: +(monthlyIncome - monthlyObligations).toFixed(2),
    totalDebt: +totalDebt.toFixed(2),
    totalSaved: +saved.toFixed(2),
    billsByCategory: [...billCat.entries()].map(([category, monthly]) => ({ category, monthly: +monthly.toFixed(2) })).sort((a, b) => b.monthly - a.monthly),
    debtCount: debts.length,
    weightedApr: +weightedApr.toFixed(2),
  };
}

// ---- Debt payoff simulation ----
// Rolling avalanche/snowball: total monthly payment stays constant (sum of
// original minimums + extra); as each debt clears, its freed minimum rolls onto
// the priority debt. Interest accrues monthly on the balance.
export type PayoffResult = {
  months: number;
  totalInterest: number;
  paysOff: boolean; // false = minimums don't even cover interest (capped)
  order: { name: string; month: number }[];
  monthlyPayment: number;
};

export function simulatePayoff(debts: Debt[], extraMonthly: number, strategy: "avalanche" | "snowball"): PayoffResult {
  const ds = debts
    .filter((d) => d.active && d.balance > 0)
    .map((d) => ({ name: d.name, balance: d.balance, apr: d.apr || 0, min: d.min_payment || 0 }));
  const baseMin = ds.reduce((s, d) => s + d.min, 0);
  const budget = baseMin + Math.max(0, extraMonthly);
  const order: { name: string; month: number }[] = [];
  let month = 0;
  let interest = 0;
  const MAX = 720; // 60-year cap = effectively "never pays off"

  while (ds.some((d) => d.balance > 0.005) && month < MAX) {
    month++;
    for (const d of ds) {
      if (d.balance > 0.005) {
        const i = d.balance * (d.apr / 100 / 12);
        d.balance += i;
        interest += i;
      }
    }
    let spent = 0;
    for (const d of ds) {
      if (d.balance > 0.005) {
        const p = Math.min(d.min, d.balance);
        d.balance -= p;
        spent += p;
      }
    }
    let rem = budget - spent;
    const active = ds
      .filter((d) => d.balance > 0.005)
      .sort((a, b) => (strategy === "snowball" ? a.balance - b.balance : b.apr - a.apr));
    for (const d of active) {
      if (rem <= 0.005) break;
      const p = Math.min(rem, d.balance);
      d.balance -= p;
      rem -= p;
    }
    for (const d of ds) {
      if (d.balance <= 0.005 && !order.find((o) => o.name === d.name)) order.push({ name: d.name, month });
    }
  }

  return {
    months: month,
    totalInterest: +interest.toFixed(2),
    paysOff: ds.every((d) => d.balance <= 0.005),
    order,
    monthlyPayment: +budget.toFixed(2),
  };
}

// ---- Savings goal feasibility ----
export type GoalPlan = {
  remaining: number;
  monthsLeft: number;
  requiredMonthly: number;
  feasible: boolean;
  shortfall: number;
};

export function monthsUntil(dateIso: string | null): number {
  if (!dateIso) return 0;
  const target = Date.parse(`${dateIso}T23:59:59`);
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, (target - Date.now()) / (86400000 * 30.4375));
}

export function goalFeasibility(goal: Goal, freeCashflow: number): GoalPlan {
  const remaining = Math.max(0, (goal.target_amount || 0) - (goal.saved_amount || 0));
  const monthsLeft = monthsUntil(goal.target_date);
  const requiredMonthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
  return {
    remaining: +remaining.toFixed(2),
    monthsLeft: +monthsLeft.toFixed(1),
    requiredMonthly: +requiredMonthly.toFixed(2),
    feasible: requiredMonthly <= freeCashflow + 0.005,
    shortfall: +Math.max(0, requiredMonthly - freeCashflow).toFixed(2),
  };
}

// ---- Net worth (assets − liabilities), per scope ----
export type NetScope = "business" | "personal";
export type NetItem = { id: number; scope: string; category: string; name: string; value: number; kind: string | null; active: number; notes: string | null };

export function listNetItems(scope: NetScope): NetItem[] {
  return getDb()
    .prepare(`SELECT * FROM finance_net_items WHERE scope=? ORDER BY category, value DESC`)
    .all(scope) as NetItem[];
}

export type NetWorth = {
  assets: number;
  liabilities: number;
  net: number;
  assetItems: NetItem[];
  liabilityItems: NetItem[];
  debtsInLiabilities: number; // personal: debts folded into liabilities
};

export function getNetWorth(scope: NetScope): NetWorth {
  const items = listNetItems(scope).filter((i) => i.active);
  const assetItems = items.filter((i) => i.category === "asset");
  const liabilityItems = items.filter((i) => i.category === "liability");
  const assets = assetItems.reduce((s, i) => s + (i.value || 0), 0);
  let liabilities = liabilityItems.reduce((s, i) => s + (i.value || 0), 0);
  let debtsInLiabilities = 0;
  if (scope === "personal") {
    debtsInLiabilities = listDebts().filter((d) => d.active).reduce((s, d) => s + (d.balance || 0), 0);
    liabilities += debtsInLiabilities;
  }
  return {
    assets: +assets.toFixed(2),
    liabilities: +liabilities.toFixed(2),
    net: +(assets - liabilities).toFixed(2),
    assetItems,
    liabilityItems,
    debtsInLiabilities: +debtsInLiabilities.toFixed(2),
  };
}

// ---- Daily snapshot for trend charts ----
export function recordSnapshot(): void {
  try {
    const s = getFinanceSummary();
    const nw = getNetWorth("personal");
    getDb()
      .prepare(
        `INSERT INTO finance_snapshots (taken_on, total_debt, total_saved, monthly_income, monthly_obligations, free_cashflow, total_assets, net_worth)
         VALUES (date('now','localtime'), ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(taken_on) DO UPDATE SET
           total_debt=excluded.total_debt, total_saved=excluded.total_saved,
           monthly_income=excluded.monthly_income, monthly_obligations=excluded.monthly_obligations,
           free_cashflow=excluded.free_cashflow, total_assets=excluded.total_assets, net_worth=excluded.net_worth`,
      )
      .run(s.totalDebt, s.totalSaved, s.monthlyIncome, s.monthlyObligations, s.freeCashflow, nw.assets, nw.net);
  } catch {
    /* snapshot is best-effort */
  }
}

export type Snapshot = { taken_on: string; total_debt: number; total_saved: number; free_cashflow: number; net_worth: number };
export function getTrend(days = 180): Snapshot[] {
  return getDb()
    .prepare(
      `SELECT taken_on, total_debt, total_saved, free_cashflow, net_worth FROM finance_snapshots
       WHERE taken_on >= date('now','localtime','-${Math.max(1, days)} days') ORDER BY taken_on ASC`,
    )
    .all() as Snapshot[];
}
