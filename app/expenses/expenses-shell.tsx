"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Camera, Plus, Loader2, Trash2, Receipt } from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import { addExpense, updateExpense, deleteExpense } from "./actions";

export type ExpenseRow = {
  id: number;
  vendor: string | null;
  amount: number | null;
  spent_on: string | null;
  category: string | null;
  scope: string | null;
  job_id: number | null;
  notes: string | null;
  photo: string | null;
};
export type JobOption = { id: number; client: string | null };

const CATEGORIES = ["materials", "tools", "fuel", "equipment", "supplies", "meals", "other"];

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
async function fileToDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Draft = {
  vendor: string;
  amount: string;
  spent_on: string;
  category: string;
  scope: string;
  job_id: string;
  notes: string;
  photoDataUrl?: string | null;
};

export function ExpensesShell({ rows, jobs }: { rows: ExpenseRow[]; jobs: JobOption[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const jobName = useMemo(() => new Map(jobs.map((j) => [j.id, j.client || `Job #${j.id}`])), [jobs]);

  const { monthTotal, allTotal } = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    let m = 0,
      a = 0;
    for (const r of rows) {
      const amt = r.amount || 0;
      a += amt;
      if ((r.spent_on || "").startsWith(ym)) m += amt;
    }
    return { monthTotal: m, allTotal: a };
  }, [rows]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setScanning(true);
    try {
      const dataUrl = await fileToDataUrl(f);
      const res = await fetch("/api/expenses/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const j = await res.json().catch(() => ({}));
      const p = j.parsed || {};
      setDraft({
        vendor: p.vendor || "",
        amount: p.amount != null ? String(p.amount) : "",
        spent_on: p.spent_on || new Date().toISOString().slice(0, 10),
        category: p.category || "other",
        scope: "business",
        job_id: "",
        notes: p.summary || "",
        photoDataUrl: dataUrl,
      });
    } catch {
      // fall back to a blank manual form keyed to today
      setDraft(blankDraft());
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />

      <div className="px-4 pt-3 grid grid-cols-2 gap-2">
        <Stat label="This month" value={money(monthTotal)} />
        <Stat label="All time" value={money(allTotal)} />
      </div>

      <div className="px-4 pt-3 flex justify-end">
        <button onClick={() => setDraft(blankDraft())} className="text-xs font-mono text-bone-dim hover:text-bone">
          + add manually
        </button>
      </div>

      <ul className="px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <li className="text-center text-xs text-bone-dim font-mono py-10">
            No expenses yet. Tap the camera to scan a receipt.
          </li>
        )}
        {rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => setEditing(r)}
              className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
            >
              <div className="w-9 h-9 shrink-0 grid place-items-center rounded-lg bg-surface-2 text-bone-dim">
                <Receipt size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-bone truncate">{r.vendor || "(no vendor)"}</div>
                <div className="text-[12px] text-bone-dim truncate">
                  {r.scope === "personal" && <span className="font-mono text-[10px] uppercase tracking-wide text-periwinkle">personal · </span>}
                  {r.category || "other"}
                  {r.job_id && jobName.get(r.job_id) ? ` · ${jobName.get(r.job_id)}` : ""}
                  {r.spent_on ? ` · ${r.spent_on}` : ""}
                </div>
              </div>
              <div className="shrink-0 font-semibold text-bone">{money(r.amount)}</div>
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={scanning}
        aria-label="Scan receipt"
        className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center z-10 shadow-lg disabled:opacity-70"
        style={{ background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)", boxShadow: "0 8px 24px rgba(98,92,200,0.35)" }}
      >
        {scanning ? <Loader2 size={22} className="text-bone animate-spin" /> : <Camera size={22} className="text-bone" />}
      </button>

      {scanning && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm grid place-items-center">
          <div className="flex items-center gap-2 text-bone text-sm">
            <Loader2 size={18} className="animate-spin" /> Reading receipt…
          </div>
        </div>
      )}

      {draft && <ExpenseForm draft={draft} jobs={jobs} onClose={() => setDraft(null)} mode="add" />}
      {editing && (
        <ExpenseForm
          draft={{
            vendor: editing.vendor || "",
            amount: editing.amount != null ? String(editing.amount) : "",
            spent_on: editing.spent_on || new Date().toISOString().slice(0, 10),
            category: editing.category || "other",
            scope: editing.scope || "business",
            job_id: editing.job_id ? String(editing.job_id) : "",
            notes: editing.notes || "",
          }}
          jobs={jobs}
          editId={editing.id}
          onClose={() => setEditing(null)}
          mode="edit"
        />
      )}
    </>
  );
}

function blankDraft(): Draft {
  return {
    vendor: "",
    amount: "",
    spent_on: new Date().toISOString().slice(0, 10),
    category: "other",
    scope: "business",
    job_id: "",
    notes: "",
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.16em] text-bone-mute font-mono">{label}</div>
      <div className="text-[20px] font-bold text-bone mt-0.5">{value}</div>
    </div>
  );
}

function ExpenseForm({
  draft,
  jobs,
  onClose,
  mode,
  editId,
}: {
  draft: Draft;
  jobs: JobOption[];
  onClose: () => void;
  mode: "add" | "edit";
  editId?: number;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string) => setD((p) => ({ ...p, [k]: v }));

  function save() {
    setErr(null);
    const amount = d.amount.trim() ? Number(d.amount.replace(/[^0-9.]/g, "")) : null;
    if (amount != null && !Number.isFinite(amount)) {
      setErr("Amount must be a number.");
      return;
    }
    const payload = {
      vendor: d.vendor,
      amount,
      spent_on: d.spent_on,
      category: d.category,
      scope: d.scope,
      job_id: d.job_id ? Number(d.job_id) : null,
      notes: d.notes,
    };
    start(async () => {
      if (mode === "edit" && editId != null) await updateExpense(editId, payload);
      else await addExpense({ ...payload, photoDataUrl: draft.photoDataUrl ?? null });
      onClose();
    });
  }
  function del() {
    if (editId == null) return;
    start(async () => {
      await deleteExpense(editId);
      onClose();
    });
  }

  const inputCls =
    "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

  return (
    <Sheet title={mode === "edit" ? "Edit expense" : "Confirm expense"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor">
            <input value={d.vendor} onChange={(e) => set("vendor", e.target.value)} className={inputCls} autoFocus />
          </Field>
          <Field label="Amount">
            <input value={d.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" value={d.spent_on} onChange={(e) => set("spent_on", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Category">
            <select value={d.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Business or personal">
          <div className="grid grid-cols-2 gap-2">
            {(["business", "personal"] as const).map((sc) => (
              <button key={sc} type="button" onClick={() => set("scope", sc)}
                className={`px-3 py-2 rounded-lg border text-sm capitalize transition-colors ${d.scope === sc ? "bubble-stroke-gradient text-bone" : "border-border text-bone-dim hover:text-bone"}`}>
                {sc}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Job (optional)">
          <select value={d.job_id} onChange={(e) => set("job_id", e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.client || `Job #${j.id}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input value={d.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} />
        </Field>

        {err && <p className="text-xs text-warmred font-mono">{err}</p>}

        <div className="flex items-center justify-between pt-1 gap-3">
          {mode === "edit" ? (
            <button onClick={del} disabled={pending} className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft">
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <button onClick={onClose} className="text-bone-dim text-sm hover:text-bone">
              Cancel
            </button>
          )}
          <button onClick={save} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium">
            {pending ? "Saving…" : mode === "edit" ? "Save" : "Add expense"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
