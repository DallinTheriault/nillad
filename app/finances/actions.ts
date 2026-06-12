"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  getFinanceSummary,
  simulatePayoff,
  goalFeasibility,
  listDebts,
  type Goal,
} from "@/lib/finance";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";

function refresh() {
  revalidatePath("/finances");
}
const numOrNull = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// ---------- Income ----------
export async function addIncome(f: { person: string; source: string; amount: number | string; cadence: string; received_on: string; notes: string }) {
  getDb()
    .prepare(`INSERT INTO finance_income (person, source, amount, cadence, received_on, notes, active, created_at) VALUES (?,?,?,?,?,?,1,datetime('now'))`)
    .run(f.person.trim() || null, f.source.trim() || null, numOrNull(f.amount) ?? 0, f.cadence || "biweekly", f.received_on || null, f.notes.trim() || null);
  refresh();
  return { ok: true as const };
}
export async function updateIncome(id: number, f: { person: string; source: string; amount: number | string; cadence: string; received_on: string; notes: string }) {
  getDb()
    .prepare(`UPDATE finance_income SET person=?, source=?, amount=?, cadence=?, received_on=?, notes=? WHERE id=?`)
    .run(f.person.trim() || null, f.source.trim() || null, numOrNull(f.amount) ?? 0, f.cadence || "biweekly", f.received_on || null, f.notes.trim() || null, id);
  refresh();
  return { ok: true as const };
}
export async function deleteIncome(id: number) {
  getDb().prepare(`DELETE FROM finance_income WHERE id=?`).run(id);
  refresh();
  return { ok: true as const };
}

// ---------- Debts ----------
export async function addDebt(f: { name: string; kind: string; balance: number | string; apr: number | string; min_payment: number | string; due_day: string; notes: string }) {
  getDb()
    .prepare(`INSERT INTO finance_debts (name, kind, balance, apr, min_payment, due_day, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))`)
    .run(f.name.trim() || "Debt", f.kind || "other", numOrNull(f.balance) ?? 0, numOrNull(f.apr) ?? 0, numOrNull(f.min_payment) ?? 0, numOrNull(f.due_day), f.notes.trim() || null);
  refresh();
  return { ok: true as const };
}
export async function updateDebt(id: number, f: { name: string; kind: string; balance: number | string; apr: number | string; min_payment: number | string; due_day: string; notes: string }) {
  getDb()
    .prepare(`UPDATE finance_debts SET name=?, kind=?, balance=?, apr=?, min_payment=?, due_day=?, notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.name.trim() || "Debt", f.kind || "other", numOrNull(f.balance) ?? 0, numOrNull(f.apr) ?? 0, numOrNull(f.min_payment) ?? 0, numOrNull(f.due_day), f.notes.trim() || null, id);
  refresh();
  return { ok: true as const };
}
export async function deleteDebt(id: number) {
  getDb().prepare(`DELETE FROM finance_debts WHERE id=?`).run(id);
  refresh();
  return { ok: true as const };
}

// ---------- Bills ----------
export async function addBill(f: { name: string; amount: number | string; cadence: string; category: string; due_day: string; notes: string }) {
  getDb()
    .prepare(`INSERT INTO finance_bills (name, amount, cadence, category, due_day, notes, active, created_at) VALUES (?,?,?,?,?,?,1,datetime('now'))`)
    .run(f.name.trim() || "Bill", numOrNull(f.amount) ?? 0, f.cadence || "monthly", f.category || "other", numOrNull(f.due_day), f.notes.trim() || null);
  refresh();
  return { ok: true as const };
}
export async function updateBill(id: number, f: { name: string; amount: number | string; cadence: string; category: string; due_day: string; notes: string }) {
  getDb()
    .prepare(`UPDATE finance_bills SET name=?, amount=?, cadence=?, category=?, due_day=?, notes=? WHERE id=?`)
    .run(f.name.trim() || "Bill", numOrNull(f.amount) ?? 0, f.cadence || "monthly", f.category || "other", numOrNull(f.due_day), f.notes.trim() || null, id);
  refresh();
  return { ok: true as const };
}
export async function deleteBill(id: number) {
  getDb().prepare(`DELETE FROM finance_bills WHERE id=?`).run(id);
  refresh();
  return { ok: true as const };
}

// ---------- Goals ----------
export async function addGoal(f: { name: string; target_amount: number | string; target_date: string; saved_amount: number | string; strategy: string }) {
  getDb()
    .prepare(`INSERT INTO finance_goals (name, target_amount, target_date, saved_amount, strategy, status, created_at, updated_at) VALUES (?,?,?,?,?,'active',datetime('now'),datetime('now'))`)
    .run(f.name.trim() || "Goal", numOrNull(f.target_amount) ?? 0, f.target_date || null, numOrNull(f.saved_amount) ?? 0, f.strategy || "avalanche");
  refresh();
  return { ok: true as const };
}
export async function updateGoal(id: number, f: { name: string; target_amount: number | string; target_date: string; saved_amount: number | string; strategy: string }) {
  getDb()
    .prepare(`UPDATE finance_goals SET name=?, target_amount=?, target_date=?, saved_amount=?, strategy=?, updated_at=datetime('now') WHERE id=?`)
    .run(f.name.trim() || "Goal", numOrNull(f.target_amount) ?? 0, f.target_date || null, numOrNull(f.saved_amount) ?? 0, f.strategy || "avalanche", id);
  refresh();
  return { ok: true as const };
}
export async function deleteGoal(id: number) {
  getDb().prepare(`DELETE FROM finance_goals WHERE id=?`).run(id);
  refresh();
  return { ok: true as const };
}

// ---------- Net worth items (assets / liabilities), scoped business|personal ----------
const netScope = (s: string | undefined) => (s === "business" ? "business" : "personal");
const netCat = (c: string | undefined) => (c === "liability" ? "liability" : "asset");

export async function addNetItem(f: { scope: string; category: string; name: string; value: number | string; kind: string; notes: string }) {
  getDb()
    .prepare(`INSERT INTO finance_net_items (scope, category, name, value, kind, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,datetime('now'),datetime('now'))`)
    .run(netScope(f.scope), netCat(f.category), f.name.trim() || "Item", numOrNull(f.value) ?? 0, f.kind || null, f.notes?.trim() || null);
  refresh();
  revalidatePath("/dashboard");
  return { ok: true as const };
}
export async function updateNetItem(id: number, f: { scope: string; category: string; name: string; value: number | string; kind: string; notes: string }) {
  getDb()
    .prepare(`UPDATE finance_net_items SET scope=?, category=?, name=?, value=?, kind=?, notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(netScope(f.scope), netCat(f.category), f.name.trim() || "Item", numOrNull(f.value) ?? 0, f.kind || null, f.notes?.trim() || null, id);
  refresh();
  revalidatePath("/dashboard");
  return { ok: true as const };
}
export async function deleteNetItem(id: number) {
  getDb().prepare(`DELETE FROM finance_net_items WHERE id=?`).run(id);
  refresh();
  revalidatePath("/dashboard");
  return { ok: true as const };
}

// ---------- The game plan ----------
// Compute the numbers deterministically, then have gemma phrase them into a plan
// + concrete steps. The model never does math — it only narrates the figures.
type PlanPayload = { narrative: string; steps: string[] };

export async function generatePlanAction(goalId: number): Promise<{ ok: true; plan: PlanPayload } | { ok: false; error: string }> {
  const db = getDb();
  const goal = db.prepare(`SELECT * FROM finance_goals WHERE id=?`).get(goalId) as Goal | undefined;
  if (!goal) return { ok: false, error: "Goal not found." };

  const s = getFinanceSummary();
  const fz = goalFeasibility(goal, s.freeCashflow);
  const debts = listDebts().filter((d) => d.active && d.balance > 0);
  const strategy = (goal.strategy === "snowball" ? "snowball" : "avalanche") as "avalanche" | "snowball";

  // Two scenarios: all free cashflow at debt, vs funding the goal first then debt.
  const allToDebt = debts.length ? simulatePayoff(debts, s.freeCashflow, strategy) : null;
  const leftoverForDebt = Math.max(0, +(s.freeCashflow - fz.requiredMonthly).toFixed(2));
  const goalThenDebt = debts.length ? simulatePayoff(debts, leftoverForDebt, strategy) : null;

  const facts = {
    monthlyIncome: s.monthlyIncome,
    monthlyObligations: s.monthlyObligations,
    freeCashflow: s.freeCashflow,
    totalDebt: s.totalDebt,
    weightedApr: s.weightedApr,
    debts: debts.map((d) => ({ name: d.name, balance: d.balance, apr: d.apr, min: d.min_payment })),
    goal: { name: goal.name, target: goal.target_amount, saved: goal.saved_amount, byDate: goal.target_date },
    goalRequiredMonthly: fz.requiredMonthly,
    goalMonthsLeft: fz.monthsLeft,
    goalFeasible: fz.feasible,
    goalShortfall: fz.shortfall,
    payoffAllCashToDebt: allToDebt && { months: allToDebt.months, interest: allToDebt.totalInterest, paysOff: allToDebt.paysOff },
    payoffAfterFundingGoal: goalThenDebt && { months: goalThenDebt.months, interest: goalThenDebt.totalInterest, leftoverForDebt },
    strategy,
  };

  let plan: PlanPayload = { narrative: "", steps: [] };
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        format: "json",
        think: false,
        stream: false,
        options: { temperature: 0.4 },
        messages: [
          {
            role: "system",
            content:
              "You are Dallin's blunt, encouraging personal-finance coach. You are given REAL computed numbers (all dollars). Write a game plan to hit his savings goal while getting out of debt. RULES: use ONLY the numbers provided — never invent or recompute figures; getting out of high-interest debt is the priority; be concrete and honest if the goal isn't realistic on the current cashflow (say what would have to change). Respond ONLY as JSON: {\"narrative\": 4-6 sentence plain-English plan, \"steps\": [4-6 short concrete action steps]}.",
          },
          { role: "user", content: `Here are the numbers:\n${JSON.stringify(facts, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    const m = (j.message?.content || "").match(/\{[\s\S]*\}/);
    if (m) {
      const p = JSON.parse(m[0]) as { narrative?: string; steps?: unknown };
      plan = {
        narrative: typeof p.narrative === "string" ? p.narrative.trim() : "",
        steps: Array.isArray(p.steps) ? p.steps.filter((x): x is string => typeof x === "string").slice(0, 8) : [],
      };
    }
  } catch {
    /* fall through to a deterministic fallback below */
  }

  // Deterministic fallback so the feature works even if the model hiccups.
  if (!plan.narrative) {
    const m = (n: number) => `$${Math.round(n).toLocaleString()}`;
    plan = {
      narrative: `You bring in about ${m(s.monthlyIncome)}/mo and your obligations are ${m(s.monthlyObligations)}, leaving ${m(s.freeCashflow)} of free cash flow. Your goal needs ${m(fz.requiredMonthly)}/mo for ${fz.monthsLeft} months, which is ${fz.feasible ? "doable" : `short by ${m(fz.shortfall)}/mo`}. ${allToDebt ? `Putting all free cash at your debt (${strategy}) clears ${m(s.totalDebt)} in ~${allToDebt.months} months.` : "No debts logged."}`,
      steps: [
        `Target ${m(fz.requiredMonthly)}/mo toward "${goal.name}".`,
        allToDebt ? `Attack debts ${strategy}-style; ${m(s.freeCashflow)}/mo extra clears them in ~${allToDebt.months} mo.` : "Log your debts so I can build a payoff order.",
        s.freeCashflow < fz.requiredMonthly ? `Find ${m(fz.shortfall)}/mo by trimming bills or adding income.` : `You have room — automate the transfer so it's not optional.`,
      ],
    };
  }

  db.prepare(`UPDATE finance_goals SET plan=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(plan), goalId);
  refresh();
  return { ok: true, plan };
}

// Turn the saved plan into a follow-it activity + task checklist.
export async function makePlanTaskAction(goalId: number): Promise<{ ok: true; activityId: number } | { ok: false; error: string }> {
  const db = getDb();
  const goal = db.prepare(`SELECT * FROM finance_goals WHERE id=?`).get(goalId) as Goal | undefined;
  if (!goal || !goal.plan) return { ok: false, error: "Generate a plan first." };
  let parsed: PlanPayload;
  try {
    parsed = JSON.parse(goal.plan) as PlanPayload;
  } catch {
    return { ok: false, error: "Plan is unreadable — regenerate it." };
  }
  const info = db
    .prepare(`INSERT INTO activities (title, category, status, notes, created_at, updated_at) VALUES (?, 'finance', 'active', ?, datetime('now'), datetime('now'))`)
    .run(`Plan: ${goal.name}`, parsed.narrative || null);
  const activityId = Number(info.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO tasks (activity_id, title, sort_order, created_at) VALUES (?, ?, ?, datetime('now'))`);
  parsed.steps.forEach((step, i) => ins.run(activityId, step, i));
  db.prepare(`UPDATE finance_goals SET activity_id=?, updated_at=datetime('now') WHERE id=?`).run(activityId, goalId);
  refresh();
  revalidatePath("/activities");
  return { ok: true, activityId };
}
