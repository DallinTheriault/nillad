"use client";

import { useState, useTransition } from "react";
import { Scale, Plus, Trash2, ChevronDown } from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import { addNetItem, updateNetItem, deleteNetItem } from "@/app/finances/actions";

export type NetItem = { id: number; scope: string; category: string; name: string; value: number; kind: string | null; notes: string | null };
type Scope = "business" | "personal";

const ASSET_KINDS = ["cash", "checking", "savings", "investment", "property", "vehicle", "equipment", "receivable", "other"];
const LIAB_KINDS = ["loan", "mortgage", "credit_line", "other"];
const m0 = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n || 0)).toLocaleString()}`;
const inputCls =
  "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

export function NetWorthCard({
  scope, net, assets, liabilities, debtsInLiabilities, assetItems, liabilityItems,
}: {
  scope: Scope;
  net: number; assets: number; liabilities: number; debtsInLiabilities: number;
  assetItems: NetItem[]; liabilityItems: NetItem[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ row?: NetItem; category: "asset" | "liability" } | null>(null);
  const total = Math.max(1, assets + liabilities);

  return (
    <div className="nf-card px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono flex items-center gap-1.5">
          <Scale size={12} /> Net worth
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-bone-dim hover:text-bone flex items-center gap-1">
          manage <ChevronDown size={12} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      <div className={`mt-1 text-[28px] font-semibold leading-none ${net >= 0 ? "text-emerald-400" : "text-red-soft"}`}>{m0(net)}</div>

      {/* assets vs liabilities split */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div style={{ width: `${(assets / total) * 100}%`, background: "#34d399" }} />
        <div style={{ width: `${(liabilities / total) * 100}%`, background: "#E8595B" }} />
      </div>
      <div className="mt-2 flex justify-between text-[12px]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400" /> <span className="text-bone-dim">Assets</span> <span className="text-bone font-medium">{m0(assets)}</span></span>
        <span className="flex items-center gap-1.5"><span className="text-bone font-medium">{m0(liabilities)}</span> <span className="text-bone-dim">Liabilities</span> <span className="w-2 h-2 rounded-full bg-red-soft" /></span>
      </div>
      {scope === "personal" && debtsInLiabilities > 0 && (
        <div className="mt-1 text-[10.5px] text-bone-mute">includes {m0(debtsInLiabilities)} in tracked debts</div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <NetList title="Assets" items={assetItems} color="#34d399" onEdit={(row) => setForm({ row, category: "asset" })} onAdd={() => setForm({ category: "asset" })} />
          <NetList title="Liabilities" items={liabilityItems} color="#E8595B" onEdit={(row) => setForm({ row, category: "liability" })} onAdd={() => setForm({ category: "liability" })}
            footer={scope === "personal" && debtsInLiabilities > 0 ? `+ ${m0(debtsInLiabilities)} from your debts (managed under Debts)` : undefined} />
        </div>
      )}

      {form && <NetForm scope={scope} category={form.category} row={form.row} onClose={() => setForm(null)} />}
    </div>
  );
}

function NetList({ title, items, color, onEdit, onAdd, footer }: {
  title: string; items: NetItem[]; color: string; onEdit: (r: NetItem) => void; onAdd: () => void; footer?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] uppercase tracking-[0.14em] text-bone-mute font-mono">{title}</span>
      </div>
      <div className="space-y-1">
        {items.map((i) => (
          <button key={i.id} onClick={() => onEdit(i)} className="w-full flex items-center gap-2 text-left text-[13px] rounded-lg border border-border bg-surface/40 hover:bg-surface px-3 py-2 transition-colors">
            <span className="text-bone flex-1 truncate">{i.name}</span>
            {i.kind && <span className="text-[10px] text-bone-mute font-mono">{i.kind}</span>}
            <span className="text-bone font-medium">{m0(i.value)}</span>
          </button>
        ))}
        {footer && <div className="text-[11px] text-bone-mute px-1">{footer}</div>}
        <button onClick={onAdd} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-bone-dim hover:text-bone text-[12.5px]">
          <Plus size={13} /> Add {title.toLowerCase().replace(/s$/, "")}
        </button>
      </div>
    </div>
  );
}

function NetForm({ scope, category, row, onClose }: { scope: Scope; category: "asset" | "liability"; row?: NetItem; onClose: () => void }) {
  const [d, setD] = useState({
    name: row?.name || "", value: row ? String(row.value) : "", category: (row?.category as "asset" | "liability") || category,
    kind: row?.kind || (category === "asset" ? "savings" : "loan"), notes: row?.notes || "",
  });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof d, v: string) => setD((p) => ({ ...p, [k]: v }));
  const kinds = d.category === "asset" ? ASSET_KINDS : LIAB_KINDS;
  const save = () => start(async () => { row ? await updateNetItem(row.id, { ...d, scope }) : await addNetItem({ ...d, scope }); onClose(); });
  const del = () => row && start(async () => { await deleteNetItem(row.id); onClose(); });

  return (
    <Sheet title={row ? "Edit item" : `Add ${d.category}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(["asset", "liability"] as const).map((c) => (
            <button key={c} type="button" onClick={() => set("category", c)}
              className={`px-3 py-2 rounded-lg border text-sm capitalize transition-colors ${d.category === c ? "bubble-stroke-gradient text-bone" : "border-border text-bone-dim hover:text-bone"}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder={d.category === "asset" ? "Savings" : "Truck loan"} className={inputCls} autoFocus /></Field>
          <Field label="Value"><input value={d.value} onChange={(e) => set("value", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
        </div>
        <Field label="Type"><select value={d.kind} onChange={(e) => set("kind", e.target.value)} className={inputCls}>{kinds.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select></Field>
        <div className="flex items-center justify-between pt-1 gap-3">
          {row ? (
            <button onClick={del} disabled={pending} className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft"><Trash2 size={14} /> Delete</button>
          ) : (
            <button onClick={onClose} className="text-bone-dim text-sm hover:text-bone">Cancel</button>
          )}
          <button onClick={save} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium disabled:opacity-60">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Sheet>
  );
}
