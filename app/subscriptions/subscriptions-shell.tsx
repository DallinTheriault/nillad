"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Repeat, CalendarClock, Pause, Play } from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import {
  addSubscription,
  updateSubscription,
  deleteSubscription,
  setSubscriptionActive,
} from "./actions";

export type SubRow = {
  id: number;
  name: string;
  vendor: string | null;
  amount: number;
  cadence: string;
  category: string | null;
  scope: string;
  next_renewal: string | null;
  active: number;
  notes: string | null;
};
export type Summary = { monthlyBurn: number; annualBurn: number; count: number };

const CADENCES = ["weekly", "monthly", "quarterly", "yearly"];
const CATEGORIES = [
  "software", "email", "hosting", "domain", "phone",
  "insurance", "equipment", "marketing", "banking", "other",
];

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const CADENCE_SHORT: Record<string, string> = { weekly: "/wk", monthly: "/mo", quarterly: "/qtr", yearly: "/yr" };

// Keep in sync with lib/subscriptions.ts monthlyEquivalent (redefined locally so
// this client bundle doesn't import the server module / better-sqlite3).
function monthlyEquiv(amount: number, cadence: string): number {
  const a = amount || 0;
  if (cadence === "weekly") return (a * 52) / 12;
  if (cadence === "quarterly") return a / 3;
  if (cadence === "yearly") return a / 12;
  return a;
}

type Draft = {
  name: string;
  vendor: string;
  amount: string;
  cadence: string;
  category: string;
  scope: string;
  next_renewal: string;
  notes: string;
};

export function SubscriptionsShell({
  rows,
  summary,
  upcoming,
}: {
  rows: SubRow[];
  summary: Summary;
  upcoming: SubRow[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<SubRow | null>(null);

  const active = useMemo(() => rows.filter((r) => r.active), [rows]);
  const paused = useMemo(() => rows.filter((r) => !r.active), [rows]);

  return (
    <>
      <div className="px-4 pt-3 grid grid-cols-2 gap-2">
        <Stat label="Monthly burn" value={money(summary.monthlyBurn)} />
        <Stat label="Annual burn" value={money(summary.annualBurn)} />
      </div>

      {upcoming.length > 0 && (
        <div className="px-4 pt-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-bone-mute font-mono mb-1.5">
            Renews within 30 days
          </div>
          <ul className="space-y-1.5">
            {upcoming.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 text-[13px] rounded-lg border border-border bg-surface/40 px-3 py-2"
              >
                <CalendarClock size={14} className="text-periwinkle shrink-0" />
                <span className="text-bone font-medium truncate">{r.name}</span>
                <span className="text-bone-dim">{r.next_renewal}</span>
                <span className="ml-auto text-bone font-semibold">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 pt-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.16em] text-bone-mute font-mono">
          {active.length} active{paused.length ? ` · ${paused.length} paused` : ""}
        </span>
        <button onClick={() => setDraft(blankDraft())} className="text-xs font-mono text-bone-dim hover:text-bone">
          + add
        </button>
      </div>

      <ul className="px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <li className="text-center text-xs text-bone-dim font-mono py-10">
            No subscriptions yet. Tap “+ add” to log a recurring cost.
          </li>
        )}
        {[...active, ...paused].map((r) => (
          <li key={r.id}>
            <button
              onClick={() => setEditing(r)}
              className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors ${
                r.active ? "" : "opacity-50"
              }`}
            >
              <div className="w-9 h-9 shrink-0 grid place-items-center rounded-lg bg-surface-2 text-bone-dim">
                <Repeat size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-bone truncate">
                  {r.name}
                  {!r.active && <span className="text-bone-mute font-mono text-[11px]"> · paused</span>}
                </div>
                <div className="text-[12px] text-bone-dim truncate">
                  <span className={`font-mono text-[10px] uppercase tracking-wide ${r.scope === "personal" ? "text-periwinkle" : "text-bone-mute"}`}>
                    {r.scope === "personal" ? "personal" : "business"}
                  </span>
                  {" · "}{r.category || "other"}
                  {r.next_renewal ? ` · renews ${r.next_renewal}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold text-bone">
                  {money(r.amount)}
                  <span className="text-bone-mute text-[11px] font-mono">{CADENCE_SHORT[r.cadence] || ""}</span>
                </div>
                {r.cadence !== "monthly" && (
                  <div className="text-[11px] text-bone-mute font-mono">{money(+monthlyEquiv(r.amount, r.cadence).toFixed(2))}/mo</div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {draft && <SubForm draft={draft} onClose={() => setDraft(null)} mode="add" />}
      {editing && (
        <SubForm
          draft={{
            name: editing.name,
            vendor: editing.vendor || "",
            amount: String(editing.amount ?? ""),
            cadence: editing.cadence || "monthly",
            category: editing.category || "other",
            scope: editing.scope || "business",
            next_renewal: editing.next_renewal || "",
            notes: editing.notes || "",
          }}
          editId={editing.id}
          editActive={!!editing.active}
          onClose={() => setEditing(null)}
          mode="edit"
        />
      )}
    </>
  );
}

function blankDraft(): Draft {
  return { name: "", vendor: "", amount: "", cadence: "monthly", category: "software", scope: "business", next_renewal: "", notes: "" };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-bone-mute font-mono">{label}</div>
      <div className="text-[20px] font-bold text-bone mt-0.5">{value}</div>
    </div>
  );
}

function SubForm({
  draft,
  onClose,
  mode,
  editId,
  editActive,
}: {
  draft: Draft;
  onClose: () => void;
  mode: "add" | "edit";
  editId?: number;
  editActive?: boolean;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string) => setD((p) => ({ ...p, [k]: v }));

  function save() {
    setErr(null);
    if (!d.name.trim()) {
      setErr("Give it a name.");
      return;
    }
    const amount = d.amount.trim() ? Number(d.amount.replace(/[^0-9.]/g, "")) : 0;
    if (!Number.isFinite(amount)) {
      setErr("Amount must be a number.");
      return;
    }
    const payload = {
      name: d.name,
      vendor: d.vendor,
      amount,
      cadence: d.cadence,
      category: d.category,
      scope: d.scope,
      next_renewal: d.next_renewal,
      notes: d.notes,
    };
    start(async () => {
      if (mode === "edit" && editId != null) await updateSubscription(editId, payload);
      else await addSubscription(payload);
      onClose();
    });
  }
  function del() {
    if (editId == null) return;
    start(async () => {
      await deleteSubscription(editId);
      onClose();
    });
  }
  function toggleActive() {
    if (editId == null) return;
    start(async () => {
      await setSubscriptionActive(editId, !editActive);
      onClose();
    });
  }

  const inputCls =
    "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

  return (
    <Sheet title={mode === "edit" ? "Edit subscription" : "Add subscription"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name">
          <input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Google Workspace" className={inputCls} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input value={d.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </Field>
          <Field label="Billed">
            <select value={d.cadence} onChange={(e) => set("cadence", e.target.value)} className={inputCls}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={d.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Next renewal">
            <input type="date" value={d.next_renewal} onChange={(e) => set("next_renewal", e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Counts toward">
          <div className="grid grid-cols-2 gap-2">
            {(["business", "personal"] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => set("scope", sc)}
                className={`px-3 py-2 rounded-lg border text-sm capitalize transition-colors ${
                  d.scope === sc ? "bubble-stroke-gradient text-bone" : "border-border text-bone-dim hover:text-bone"
                }`}
              >
                {sc}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Vendor (optional)">
          <input value={d.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Google" className={inputCls} />
        </Field>
        <Field label="Notes">
          <input value={d.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} />
        </Field>

        {err && <p className="text-xs text-warmred font-mono">{err}</p>}

        <div className="flex items-center justify-between pt-1 gap-3">
          {mode === "edit" ? (
            <div className="flex items-center gap-3">
              <button onClick={del} disabled={pending} className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft">
                <Trash2 size={14} /> Delete
              </button>
              <button onClick={toggleActive} disabled={pending} className="inline-flex items-center gap-1.5 text-bone-dim text-sm hover:text-bone">
                {editActive ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
              </button>
            </div>
          ) : (
            <button onClick={onClose} className="text-bone-dim text-sm hover:text-bone">
              Cancel
            </button>
          )}
          <button onClick={save} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium">
            {pending ? "Saving…" : mode === "edit" ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
