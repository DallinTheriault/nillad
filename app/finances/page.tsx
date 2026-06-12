import { PageHeader } from "@/components/page-header";
import {
  getFinanceSummary,
  listIncome,
  listDebts,
  listBills,
  listGoals,
  goalFeasibility,
  simulatePayoff,
  recordSnapshot,
  getTrend,
  getNetWorth,
} from "@/lib/finance";
import { listSubscriptions, monthlyEquivalent } from "@/lib/subscriptions";
import { FinancesShell } from "./finances-shell";

export const dynamic = "force-dynamic";

export default function FinancesPage() {
  // Stamp today's snapshot so the trend charts accumulate history over time.
  recordSnapshot();

  const summary = getFinanceSummary();
  const income = listIncome();
  const debts = listDebts();
  const bills = listBills();
  const goals = listGoals();
  const trend = getTrend(180);
  const netWorth = getNetWorth("personal");

  const personalSubs = listSubscriptions(true, "personal").map((s) => ({
    id: s.id,
    name: s.name,
    monthly: +monthlyEquivalent(s.amount, s.cadence).toFixed(2),
  }));

  const activeDebts = debts.filter((d) => d.active && d.balance > 0);
  const payoff = activeDebts.length
    ? {
        avalanche: simulatePayoff(activeDebts, summary.freeCashflow, "avalanche"),
        snowball: simulatePayoff(activeDebts, summary.freeCashflow, "snowball"),
      }
    : null;

  const goalViews = goals.map((g) => ({
    ...g,
    feasibility: goalFeasibility(g, summary.freeCashflow),
    planParsed: (() => {
      try {
        return g.plan ? (JSON.parse(g.plan) as { narrative: string; steps: string[] }) : null;
      } catch {
        return null;
      }
    })(),
  }));

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Finances" />
      <FinancesShell
        summary={summary}
        income={income}
        debts={debts}
        bills={bills}
        personalSubs={personalSubs}
        goals={goalViews}
        payoff={payoff}
        netWorth={netWorth}
        trend={{
          debt: trend.map((t) => t.total_debt),
          saved: trend.map((t) => t.total_saved),
          net: trend.map((t) => t.net_worth),
        }}
      />
    </main>
  );
}
