import { PageHeader } from "@/components/page-header";
import { getDashboard } from "@/lib/dashboard";
import { getNetWorth } from "@/lib/finance";
import { NetWorthCard } from "@/components/net-worth-card";

export const dynamic = "force-dynamic";

const money = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "America/Denver" }).format(
  new Date(),
);

// Colors for aging buckets / pipeline segments (the "C" data-forward palette).
const AGING_COLOR = ["#34d399", "#fbbf24", "#E8595B"]; // 0–7 / 8–30 / 30+
const STAGE_COLOR: Record<string, string> = {
  lead: "#38bdf8",
  quoted: "#fbbf24",
  scheduled: "#7E78D6",
  active: "#625CC8",
  done: "#34d399",
  invoiced: "#a78bfa",
};

export default function DashboardPage() {
  const d = getDashboard();
  const bnw = getNetWorth("business");
  const maxCat = Math.max(1, ...d.expenseCats.map((c) => c.amount));
  const pipelineTotal = Math.max(1, ...[d.pipeline.reduce((s, p) => s + p.count, 0)]);

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-24">
      <PageHeader title="Dashboard" />

      <div className="px-3 space-y-4">
        {/* Hero — this month */}
        <div className="nf-card px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">
            This month · {monthLabel}
          </div>
          <div className="mt-1.5 flex items-end justify-between">
            <div>
              <div className="text-[32px] font-semibold leading-none text-bone">{money(d.revenueMtd)}</div>
              <div className="mt-1 text-[11px] text-bone-mute">revenue in</div>
            </div>
            <div className="text-right">
              <div className={`text-[18px] font-semibold leading-none ${d.netMtd >= 0 ? "text-emerald-400" : "text-red-soft"}`}>
                {money(d.netMtd)}
              </div>
              <div className="mt-1 text-[11px] text-bone-mute">net · {money(d.expensesMtd)} spend</div>
            </div>
          </div>
          {d.recurringMonthly > 0 ? (
            <a
              href="/subscriptions"
              className="mt-3 flex items-center justify-between border-t border-border pt-2.5 text-[11.5px] text-bone-mute hover:text-bone-dim"
            >
              <span>Recurring subscriptions</span>
              <span className="text-bone-dim">
                {money2(d.recurringMonthly)}/mo · {money(d.recurringMonthly * 12)}/yr →
              </span>
            </a>
          ) : null}
        </div>

        {/* Net worth (business) */}
        <NetWorthCard
          scope="business"
          net={bnw.net}
          assets={bnw.assets}
          liabilities={bnw.liabilities}
          debtsInLiabilities={bnw.debtsInLiabilities}
          assetItems={bnw.assetItems}
          liabilityItems={bnw.liabilityItems}
        />

        {/* Owed + aging */}
        <div className="nf-card px-4 py-4">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">Money owed</div>
            <div className="text-[11px] text-bone-mute">
              {d.owedCount} invoice{d.owedCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="mt-1 text-[26px] font-semibold leading-none text-periwinkle-soft">
            {money(d.owedTotal)}
          </div>

          {d.owedTotal === 0 ? (
            <p className="mt-2 text-[13px] text-bone-mute">All paid up — nothing outstanding.</p>
          ) : (
            <>
              {/* Segmented aging bar */}
              <div className="nf-bar mt-3">
                {d.aging.map((b, i) =>
                  b.amount > 0 ? (
                    <div
                      key={b.label}
                      style={{ width: `${(b.amount / d.owedTotal) * 100}%`, background: AGING_COLOR[i] }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {d.aging.map((b, i) => (
                  <div key={b.label} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: AGING_COLOR[i] }} />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-bone leading-none">{money(b.amount)}</div>
                      <div className="text-[10px] text-bone-mute">{b.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Oldest unpaid */}
              <div className="mt-3 nf-tile divide-y divide-border">
                {d.unpaid.map((u) => (
                  <div key={u.number} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-bone">{u.job}</div>
                      <div className="text-[10.5px] text-bone-mute">
                        {u.number} · {u.days}d
                      </div>
                    </div>
                    <span className={`shrink-0 text-[13px] font-medium ${u.days > 30 ? "text-red-soft" : "text-bone"}`}>
                      {money2(u.total)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Pipeline */}
        <div className="nf-card px-4 py-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">Jobs pipeline</div>
            <div className="text-[11px] text-bone-mute">
              {d.pipeline.reduce((s, p) => s + p.count, 0)} open
            </div>
          </div>
          {d.pipeline.length === 0 ? (
            <p className="text-[13px] text-bone-mute">No open jobs.</p>
          ) : (
            <>
              <div className="nf-bar">
                {d.pipeline.map((p) => (
                  <div
                    key={p.status}
                    style={{ width: `${(p.count / pipelineTotal) * 100}%`, background: STAGE_COLOR[p.status] || "#7A7872" }}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {d.pipeline.map((p) => (
                  <div key={p.status} className="nf-tile px-2.5 py-2 text-center">
                    <div className="text-[18px] font-semibold text-bone leading-none">{p.count}</div>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE_COLOR[p.status] || "#7A7872" }} />
                      <span className="text-[10px] uppercase tracking-wide text-bone-mute">{p.status}</span>
                    </div>
                    {p.value > 0 ? <div className="mt-0.5 text-[10.5px] text-bone-dim">{money(p.value)}</div> : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Spend by category */}
        <div className="nf-card px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-2.5">
            Spend by category · {monthLabel}
          </div>
          {d.expenseCats.length === 0 ? (
            <p className="text-[13px] text-bone-mute">No expenses logged this month.</p>
          ) : (
            <div className="space-y-2">
              {d.expenseCats.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[12px] text-bone-dim capitalize">{c.category}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-periwinkle/70" style={{ width: `${Math.max(4, (c.amount / maxCat) * 100)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[12px] text-bone">{money(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {d.revenueAll > 0 ? (
          <p className="px-1 text-[11.5px] text-bone-mute">All-time paid: {money(d.revenueAll)}</p>
        ) : null}
      </div>
    </main>
  );
}
