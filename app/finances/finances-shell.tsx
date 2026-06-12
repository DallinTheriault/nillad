"use client";

import { useState, useTransition } from "react";
import {
  Plus, Trash2, TrendingDown, Wallet, CreditCard, Target, ChevronDown,
  Sparkles, ListChecks, ArrowRight, Loader2,
} from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import { Donut, TrendLine, Bars, type Segment } from "@/components/fin-charts";
import { NetWorthCard, type NetItem } from "@/components/net-worth-card";
import {
  addIncome, updateIncome, deleteIncome,
  addDebt, updateDebt, deleteDebt,
  addBill, updateBill, deleteBill,
  addGoal, updateGoal, deleteGoal,
  generatePlanAction, makePlanTaskAction,
} from "./actions";

// ---- types (mirror lib/finance row shapes; redeclared so this client bundle
// never imports the server module / better-sqlite3) ----
type Summary = {
  monthlyIncome: number; incomeByPerson: { person: string; monthly: number }[];
  monthlyBills: number; monthlySubs: number; monthlyDebtMin: number;
  monthlyObligations: number; freeCashflow: number; totalDebt: number; totalSaved: number;
  billsByCategory: { category: string; monthly: number }[]; debtCount: number; weightedApr: number;
};
type Income = { id: number; person: string | null; source: string | null; amount: number; cadence: string; received_on: string | null; notes: string | null };
type Debt = { id: number; name: string; kind: string | null; balance: number; apr: number; min_payment: number; due_day: number | null; notes: string | null };
type Bill = { id: number; name: string; amount: number; cadence: string; category: string | null; due_day: number | null; notes: string | null };
type Payoff = { months: number; totalInterest: number; paysOff: boolean; order: { name: string; month: number }[]; monthlyPayment: number };
type GoalView = {
  id: number; name: string; target_amount: number; target_date: string | null; saved_amount: number; strategy: string | null; activity_id: number | null;
  feasibility: { remaining: number; monthsLeft: number; requiredMonthly: number; feasible: boolean; shortfall: number };
  planParsed: { narrative: string; steps: string[] } | null;
};

const INCOME_CADENCES = ["once", "weekly", "biweekly", "semimonthly", "monthly", "yearly"];
const BILL_CADENCES = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"];
const DEBT_KINDS = ["credit_card", "auto", "student", "personal", "medical", "other"];
const BILL_CATEGORIES = ["housing", "utilities", "groceries", "transport", "insurance", "phone", "childcare", "medical", "other"];
const PALETTE = ["#625CC8", "#7E78D6", "#D52F31", "#fbbf24", "#34d399", "#38bdf8", "#a78bfa", "#E8595B", "#0e7490", "#f472b6"];

const m0 = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const m2 = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthsLabel = (n: number) => (n >= 24 ? `${(n / 12).toFixed(1)} yr` : `${Math.round(n)} mo`);
const inputCls =
  "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

type Modal =
  | { type: "income"; row?: Income }
  | { type: "debt"; row?: Debt }
  | { type: "bill"; row?: Bill }
  | { type: "goal"; row?: GoalView }
  | null;

type NetWorth = { assets: number; liabilities: number; net: number; debtsInLiabilities: number; assetItems: NetItem[]; liabilityItems: NetItem[] };

export function FinancesShell({
  summary, income, debts, bills, personalSubs, goals, payoff, netWorth, trend,
}: {
  summary: Summary;
  income: Income[];
  debts: Debt[];
  bills: Bill[];
  personalSubs: { id: number; name: string; monthly: number }[];
  goals: GoalView[];
  payoff: { avalanche: Payoff; snowball: Payoff } | null;
  netWorth: NetWorth;
  trend: { debt: number[]; saved: number[]; net: number[] };
}) {
  const [modal, setModal] = useState<Modal>(null);

  const obligationSegs: Segment[] = [
    { label: "Bills", value: summary.monthlyBills, color: "#625CC8" },
    { label: "Subscriptions", value: summary.monthlySubs, color: "#7E78D6" },
    { label: "Debt minimums", value: summary.monthlyDebtMin, color: "#D52F31" },
  ].filter((s) => s.value > 0);

  const activeDebts = debts.filter((d) => d.balance > 0);
  const debtSegs: Segment[] = activeDebts.map((d, i) => ({ label: d.name, value: d.balance, color: PALETTE[i % PALETTE.length] }));

  return (
    <div className="px-3 space-y-4">
      {/* ===== Overview hero ===== */}
      <div className="nf-card px-4 py-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">Free cash flow · monthly</div>
        <div className={`mt-1 text-[32px] font-semibold leading-none ${summary.freeCashflow >= 0 ? "text-emerald-400" : "text-red-soft"}`}>
          {m2(summary.freeCashflow)}
        </div>
        <div className="mt-1 text-[11.5px] text-bone-mute">
          {m0(summary.monthlyIncome)} in − {m0(summary.monthlyObligations)} obligations
        </div>
        {summary.freeCashflow < 0 && (
          <div className="mt-2 text-[12px] text-red-soft font-mono">⚠ Spending more than you bring in — the plan will focus here.</div>
        )}
        {obligationSegs.length > 0 && (
          <div className="mt-3 flex items-center gap-4">
            <Donut segments={obligationSegs} size={120} thickness={16} centerTop={m0(summary.monthlyObligations)} centerBottom="OUT/MO" />
            <div className="flex-1 space-y-1.5">
              {obligationSegs.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-bone-dim flex-1">{s.label}</span>
                  <span className="text-bone font-medium">{m0(s.value)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== Net worth ===== */}
      <NetWorthCard
        scope="personal"
        net={netWorth.net}
        assets={netWorth.assets}
        liabilities={netWorth.liabilities}
        debtsInLiabilities={netWorth.debtsInLiabilities}
        assetItems={netWorth.assetItems}
        liabilityItems={netWorth.liabilityItems}
      />

      {/* ===== Debt ===== */}
      <div className="nf-card px-4 py-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono flex items-center gap-1.5">
            <CreditCard size={12} /> Total debt
          </div>
          {summary.weightedApr > 0 && <div className="text-[11px] text-bone-mute">avg {summary.weightedApr.toFixed(1)}% APR</div>}
        </div>
        <div className="mt-1 text-[26px] font-semibold leading-none text-red-soft">{m0(summary.totalDebt)}</div>

        {activeDebts.length === 0 ? (
          <p className="mt-2 text-[13px] text-bone-mute">No debts logged. Add them to get a payoff plan.</p>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-4">
              <Donut segments={debtSegs} size={120} thickness={16} centerTop={String(activeDebts.length)} centerBottom="DEBTS" />
              <div className="flex-1 space-y-1.5">
                {activeDebts.slice(0, 5).map((d, i) => (
                  <button key={d.id} onClick={() => setModal({ type: "debt", row: d })} className="w-full flex items-center gap-2 text-[12.5px] text-left">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="text-bone-dim flex-1 truncate">{d.name}</span>
                    <span className="text-bone font-medium">{m0(d.balance)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Payoff preview */}
            {payoff && (
              <div className="mt-3 nf-tile px-3 py-2.5">
                {summary.freeCashflow <= 0 ? (
                  <p className="text-[12.5px] text-bone-dim">
                    With no free cash flow you can only cover minimums. Free up cash and I&apos;ll show a real payoff timeline.
                  </p>
                ) : (
                  <>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-bone-mute font-mono mb-1.5">
                      Payoff with {m0(summary.freeCashflow)}/mo extra
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                      <PayoffCell label="Avalanche" sub="(lowest interest)" p={payoff.avalanche} best={payoff.avalanche.totalInterest <= payoff.snowball.totalInterest} />
                      <PayoffCell label="Snowball" sub="(fastest wins)" p={payoff.snowball} best={payoff.snowball.totalInterest < payoff.avalanche.totalInterest} />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <SectionAdd onClick={() => setModal({ type: "debt" })} label="Add debt" />
      </div>

      {/* ===== Trends ===== */}
      {(trend.debt.length > 1 || trend.saved.length > 1 || trend.net.length > 1) && (
        <div className="nf-card px-4 py-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono flex items-center gap-1.5">
            <TrendingDown size={12} /> Over time
          </div>
          <div>
            <div className="flex justify-between text-[11.5px] text-bone-dim mb-0.5"><span>Net worth</span><span>{m0(netWorth.net)}</span></div>
            <TrendLine values={trend.net} color="#7E78D6" />
          </div>
          <div>
            <div className="flex justify-between text-[11.5px] text-bone-dim mb-0.5"><span>Total debt</span><span>{m0(summary.totalDebt)}</span></div>
            <TrendLine values={trend.debt} color="#E8595B" />
          </div>
          <div>
            <div className="flex justify-between text-[11.5px] text-bone-dim mb-0.5"><span>Total saved</span><span>{m0(summary.totalSaved)}</span></div>
            <TrendLine values={trend.saved} color="#34d399" />
          </div>
        </div>
      )}

      {/* ===== Goals + planner ===== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono flex items-center gap-1.5">
            <Target size={13} /> Savings goals
          </h2>
          <button onClick={() => setModal({ type: "goal" })} className="text-xs font-mono text-bone-dim hover:text-bone">+ add goal</button>
        </div>
        {goals.length === 0 && (
          <p className="px-1 text-[13px] text-bone-mute">Set a goal like “$10,000 by Sept 30” and I&apos;ll build a game plan.</p>
        )}
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} freeCashflow={summary.freeCashflow} onEdit={() => setModal({ type: "goal", row: g })} />
        ))}
      </div>

      {/* ===== Ledger sections ===== */}
      <LedgerSection
        title="Income" icon={<Wallet size={13} />} count={income.length}
        addLabel="Add income" onAdd={() => setModal({ type: "income" })}
        subtitle={`${m0(summary.monthlyIncome)}/mo`}
      >
        {income.map((i) => (
          <Row key={i.id} onClick={() => setModal({ type: "income", row: i })}
            title={i.source || i.person || "Income"} sub={`${i.person || "—"} · ${i.cadence}`} amount={`${m0(i.amount)}/${shortCadence(i.cadence)}`} positive />
        ))}
      </LedgerSection>

      <LedgerSection
        title="Bills & needs" icon={<CreditCard size={13} />} count={bills.length + personalSubs.length}
        addLabel="Add bill" onAdd={() => setModal({ type: "bill" })}
        subtitle={`${m0(summary.monthlyBills + summary.monthlySubs)}/mo`}
      >
        {bills.map((b) => (
          <Row key={b.id} onClick={() => setModal({ type: "bill", row: b })}
            title={b.name} sub={`${b.category || "other"} · ${b.cadence}`} amount={`${m0(b.amount)}/${shortCadence(b.cadence)}`} />
        ))}
        {personalSubs.map((s) => (
          <Row key={`sub-${s.id}`} href="/subscriptions"
            title={s.name} sub="personal subscription" amount={`${m0(s.monthly)}/mo`} muted />
        ))}
      </LedgerSection>

      {/* ===== Forms ===== */}
      {modal?.type === "income" && <IncomeForm row={modal.row} onClose={() => setModal(null)} />}
      {modal?.type === "debt" && <DebtForm row={modal.row} onClose={() => setModal(null)} />}
      {modal?.type === "bill" && <BillForm row={modal.row} onClose={() => setModal(null)} />}
      {modal?.type === "goal" && <GoalForm row={modal.row} onClose={() => setModal(null)} />}
    </div>
  );
}

function shortCadence(c: string) {
  return c === "once" ? "once" : c === "weekly" ? "wk" : c === "biweekly" ? "2wk" : c === "semimonthly" ? "2x/mo" : c === "quarterly" ? "qtr" : c === "yearly" ? "yr" : "mo";
}

function PayoffCell({ label, sub, p, best }: { label: string; sub: string; p: Payoff; best: boolean }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 border ${best ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}>
      <div className="flex items-center gap-1">
        <span className="text-bone font-medium">{label}</span>
        {best && <span className="text-[9px] text-emerald-400 font-mono uppercase">best</span>}
      </div>
      <div className="text-[10.5px] text-bone-mute">{sub}</div>
      <div className="mt-1 text-bone">{p.paysOff ? monthsLabel(p.months) : "—"}</div>
      <div className="text-[11px] text-bone-dim">{p.paysOff ? `${m0(p.totalInterest)} interest` : "minimums too low"}</div>
    </div>
  );
}

function GoalCard({ goal, freeCashflow, onEdit }: { goal: GoalView; freeCashflow: number; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState(goal.planParsed);
  const [madeTask, setMadeTask] = useState(!!goal.activity_id);
  const [err, setErr] = useState<string | null>(null);
  const f = goal.feasibility;
  const pct = goal.target_amount > 0 ? Math.min(100, (goal.saved_amount / goal.target_amount) * 100) : 0;

  function genPlan() {
    setErr(null);
    start(async () => {
      const r = await generatePlanAction(goal.id);
      if (!r.ok) setErr(r.error);
      else setPlan(r.plan);
    });
  }
  function makeTask() {
    start(async () => {
      const r = await makePlanTaskAction(goal.id);
      if (!r.ok) setErr(r.error);
      else setMadeTask(true);
    });
  }

  return (
    <div className="nf-card px-4 py-3.5">
      <button onClick={onEdit} className="w-full text-left">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-bone">{goal.name}</span>
          <span className="text-[12px] text-bone-dim">{m0(goal.saved_amount)} / {m0(goal.target_amount)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-periwinkle to-emerald-400" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-[12px] text-bone-mute">
          {goal.target_date ? `By ${goal.target_date} · ${monthsLabel(f.monthsLeft)} left · ` : ""}
          needs <span className={f.feasible ? "text-emerald-400" : "text-red-soft"}>{m0(f.requiredMonthly)}/mo</span>
          {f.feasible ? " — on track" : ` (short ${m0(f.shortfall)}/mo)`}
        </div>
      </button>

      {err && <p className="mt-2 text-[12px] text-warmred font-mono">{err}</p>}

      {plan ? (
        <div className="mt-3 nf-tile px-3 py-2.5 space-y-2">
          <p className="text-[13px] text-bone-dim leading-relaxed whitespace-pre-wrap">{plan.narrative}</p>
          {plan.steps.length > 0 && (
            <ul className="space-y-1">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] text-bone">
                  <span className="text-periwinkle">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={genPlan} disabled={pending} className="text-[12px] text-bone-dim hover:text-bone inline-flex items-center gap-1">
              {pending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Regenerate
            </button>
            {madeTask ? (
              <a href={goal.activity_id ? `/activities/${goal.activity_id}` : "/activities"} className="ml-auto text-[12px] text-emerald-400 inline-flex items-center gap-1">
                <ListChecks size={12} /> Tracking it <ArrowRight size={12} />
              </a>
            ) : (
              <button onClick={makeTask} disabled={pending} className="ml-auto gradient-pill px-3 py-1.5 text-[12px] font-medium inline-flex items-center gap-1">
                <ListChecks size={12} /> Make it a plan I follow
              </button>
            )}
          </div>
        </div>
      ) : (
        <button onClick={genPlan} disabled={pending} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border text-bone-dim hover:text-bone text-sm disabled:opacity-50">
          {pending ? <><Loader2 size={14} className="animate-spin" /> Building your plan…</> : <><Sparkles size={14} /> Build me a game plan</>}
        </button>
      )}
    </div>
  );
}

function LedgerSection({
  title, icon, count, subtitle, addLabel, onAdd, children,
}: {
  title: string; icon: React.ReactNode; count: number; subtitle: string;
  addLabel: string; onAdd: () => void; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nf-card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <span className="text-bone-dim">{icon}</span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono">{title}</span>
        <span className="text-[11px] text-bone-mute">({count})</span>
        <span className="ml-auto text-[12px] text-bone-dim">{subtitle}</span>
        <ChevronDown size={14} className={`text-bone-mute transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {children}
          <SectionAdd onClick={onAdd} label={addLabel} />
        </div>
      )}
    </div>
  );
}

function SectionAdd({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-bone-dim hover:text-bone text-[13px]">
      <Plus size={14} /> {label}
    </button>
  );
}

function Row({ title, sub, amount, onClick, href, positive, muted }: {
  title: string; sub: string; amount: string; onClick?: () => void; href?: string; positive?: boolean; muted?: boolean;
}) {
  const inner = (
    <div className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-surface/40 ${onClick || href ? "hover:bg-surface" : ""} transition-colors ${muted ? "opacity-70" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] text-bone truncate">{title}</div>
        <div className="text-[11.5px] text-bone-mute truncate">{sub}</div>
      </div>
      <div className={`shrink-0 text-[13px] font-medium ${positive ? "text-emerald-400" : "text-bone"}`}>{amount}</div>
    </div>
  );
  if (href) return <a href={href}>{inner}</a>;
  return <button onClick={onClick} className="w-full">{inner}</button>;
}

// ---------------- Forms ----------------

function FormShell({ title, onClose, onSave, onDelete, pending, err, children }: {
  title: string; onClose: () => void; onSave: () => void; onDelete?: () => void; pending: boolean; err: string | null; children: React.ReactNode;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-3">
        {children}
        {err && <p className="text-xs text-warmred font-mono">{err}</p>}
        <div className="flex items-center justify-between pt-1 gap-3">
          {onDelete ? (
            <button onClick={onDelete} disabled={pending} className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft">
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <button onClick={onClose} className="text-bone-dim text-sm hover:text-bone">Cancel</button>
          )}
          <button onClick={onSave} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium disabled:opacity-60">
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function IncomeForm({ row, onClose }: { row?: Income; onClose: () => void }) {
  const [d, setD] = useState({
    person: row?.person || "me", source: row?.source || "", amount: row ? String(row.amount) : "",
    cadence: row?.cadence || "biweekly", received_on: row?.received_on || "", notes: row?.notes || "",
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((p) => ({ ...p, [k]: v }));
  const save = () => start(async () => { row ? await updateIncome(row.id, d) : await addIncome(d); onClose(); });
  const del = () => row && start(async () => { await deleteIncome(row.id); onClose(); });
  return (
    <FormShell title={row ? "Edit income" : "Add income"} onClose={onClose} onSave={save} onDelete={row ? del : undefined} pending={pending} err={null}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Who"><input value={d.person} onChange={(e) => set("person", e.target.value)} placeholder="me / wife" className={inputCls} /></Field>
        <Field label="Amount"><input value={d.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
      </div>
      <Field label="Source"><input value={d.source} onChange={(e) => set("source", e.target.value)} placeholder="Sharpline paycheck" className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How often"><select value={d.cadence} onChange={(e) => set("cadence", e.target.value)} className={inputCls}>{INCOME_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label="Date (optional)"><input type="date" value={d.received_on} onChange={(e) => set("received_on", e.target.value)} className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

function DebtForm({ row, onClose }: { row?: Debt; onClose: () => void }) {
  const [d, setD] = useState({
    name: row?.name || "", kind: row?.kind || "credit_card", balance: row ? String(row.balance) : "",
    apr: row ? String(row.apr) : "", min_payment: row ? String(row.min_payment) : "", due_day: row?.due_day ? String(row.due_day) : "", notes: row?.notes || "",
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((p) => ({ ...p, [k]: v }));
  const save = () => start(async () => { row ? await updateDebt(row.id, d) : await addDebt(d); onClose(); });
  const del = () => row && start(async () => { await deleteDebt(row.id); onClose(); });
  return (
    <FormShell title={row ? "Edit debt" : "Add debt"} onClose={onClose} onSave={save} onDelete={row ? del : undefined} pending={pending} err={null}>
      <Field label="Name"><input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Chase Visa" className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Balance"><input value={d.balance} onChange={(e) => set("balance", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
        <Field label="APR %"><input value={d.apr} onChange={(e) => set("apr", e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min payment"><input value={d.min_payment} onChange={(e) => set("min_payment", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
        <Field label="Type"><select value={d.kind} onChange={(e) => set("kind", e.target.value)} className={inputCls}>{DEBT_KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select></Field>
      </div>
    </FormShell>
  );
}

function BillForm({ row, onClose }: { row?: Bill; onClose: () => void }) {
  const [d, setD] = useState({
    name: row?.name || "", amount: row ? String(row.amount) : "", cadence: row?.cadence || "monthly",
    category: row?.category || "housing", due_day: row?.due_day ? String(row.due_day) : "", notes: row?.notes || "",
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((p) => ({ ...p, [k]: v }));
  const save = () => start(async () => { row ? await updateBill(row.id, d) : await addBill(d); onClose(); });
  const del = () => row && start(async () => { await deleteBill(row.id); onClose(); });
  return (
    <FormShell title={row ? "Edit bill" : "Add bill"} onClose={onClose} onSave={save} onDelete={row ? del : undefined} pending={pending} err={null}>
      <Field label="Name"><input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Rent" className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount"><input value={d.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
        <Field label="How often"><select value={d.cadence} onChange={(e) => set("cadence", e.target.value)} className={inputCls}>{BILL_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
      </div>
      <Field label="Category"><select value={d.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>{BILL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
    </FormShell>
  );
}

function GoalForm({ row, onClose }: { row?: GoalView; onClose: () => void }) {
  const [d, setD] = useState({
    name: row?.name || "", target_amount: row ? String(row.target_amount) : "", target_date: row?.target_date || "",
    saved_amount: row ? String(row.saved_amount) : "", strategy: row?.strategy || "avalanche",
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((p) => ({ ...p, [k]: v }));
  const save = () => start(async () => { row ? await updateGoal(row.id, d) : await addGoal(d); onClose(); });
  const del = () => row && start(async () => { await deleteGoal(row.id); onClose(); });
  return (
    <FormShell title={row ? "Edit goal" : "New goal"} onClose={onClose} onSave={save} onDelete={row ? del : undefined} pending={pending} err={null}>
      <Field label="Goal"><input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Save $10,000" className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target $"><input value={d.target_amount} onChange={(e) => set("target_amount", e.target.value)} inputMode="decimal" placeholder="10000" className={inputCls} /></Field>
        <Field label="By date"><input type="date" value={d.target_date} onChange={(e) => set("target_date", e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Saved so far"><input value={d.saved_amount} onChange={(e) => set("saved_amount", e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} /></Field>
        <Field label="Debt strategy"><select value={d.strategy} onChange={(e) => set("strategy", e.target.value)} className={inputCls}><option value="avalanche">avalanche</option><option value="snowball">snowball</option></select></Field>
      </div>
    </FormShell>
  );
}
