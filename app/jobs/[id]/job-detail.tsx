"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Send, FileText, Check, CreditCard, Copy } from "lucide-react";
import type { Job, LineItem } from "@/lib/jobs";
import {
  updateJobAction,
  setPaidAction,
  addItemAction,
  updateItemAction,
  deleteItemAction,
  createInvoiceAction,
  sendInvoiceAction,
  createPaymentLinkAction,
} from "../actions";

export type ContactOption = { id: number; name: string | null; phone: string | null };
type InvoiceView = { id: number; number: string | null; kind: string; status: string; total: number; text: string; stripeUrl: string | null };
type Biller = { key: "tps" | "sharpline"; name: string };

const STATUSES = ["lead", "quoted", "scheduled", "active", "done", "invoiced", "paid"];
const money = (n: number | null | undefined) => `$${(n || 0).toFixed(2)}`;
const inputCls =
  "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

export function JobDetail({
  job,
  items,
  contacts,
  invoices,
  defaultBiller,
  billers,
}: {
  job: Job;
  items: LineItem[];
  contacts: ContactOption[];
  contactName: string | null;
  contactPhone: string | null;
  invoices: InvoiceView[];
  defaultBiller: "tps" | "sharpline";
  billers: Biller[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    title: job.title || "",
    client: job.client || "",
    location: job.location || "",
    scope: job.scope || "",
    quoted_price: job.quoted_price != null ? String(job.quoted_price) : "",
    contact_id: job.contact_id != null ? String(job.contact_id) : "",
    status: job.status || "lead",
  });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);

  function saveFields() {
    start(async () => {
      await updateJobAction(job.id, {
        title: f.title || null,
        client: f.client || null,
        location: f.location || null,
        scope: f.scope || null,
        quoted_price: f.quoted_price ? Number(f.quoted_price.replace(/[^0-9.]/g, "")) : null,
        contact_id: f.contact_id ? Number(f.contact_id) : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }
  function changeStatus(status: string) {
    set("status", status);
    start(async () => {
      await updateJobAction(job.id, { status });
      router.refresh();
    });
  }
  function togglePaid() {
    start(async () => {
      await setPaidAction(job.id, !job.paid);
      router.refresh();
    });
  }

  return (
    <div className="px-4 py-3 space-y-5">
      {/* Status + paid */}
      <div className="flex items-center gap-2">
        <select value={f.status} onChange={(e) => changeStatus(e.target.value)} className={`${inputCls} flex-1`}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={togglePaid}
          disabled={pending}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition ${
            job.paid ? "border-green-400/40 text-green-400 bg-green-400/10" : "border-border text-bone-dim hover:text-bone"
          }`}
        >
          {job.paid ? "✓ Paid" : "Mark paid"}
        </button>
      </div>

      {/* Core fields */}
      <div className="space-y-3">
        <L label="Job name"><input value={f.title} onChange={(e) => set("title", e.target.value)} className={inputCls} /></L>
        <div className="grid grid-cols-2 gap-3">
          <L label="Client"><input value={f.client} onChange={(e) => set("client", e.target.value)} className={inputCls} /></L>
          <L label="Quoted $"><input value={f.quoted_price} onChange={(e) => set("quoted_price", e.target.value)} inputMode="decimal" className={inputCls} /></L>
        </div>
        <L label="Address"><input value={f.location} onChange={(e) => set("location", e.target.value)} className={inputCls} /></L>
        <L label="Primary contact">
          <select value={f.contact_id} onChange={(e) => set("contact_id", e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || `#${c.id}`}{c.phone ? ` (${c.phone})` : ""}
              </option>
            ))}
          </select>
        </L>
        <L label="Scope of work"><textarea value={f.scope} onChange={(e) => set("scope", e.target.value)} rows={3} className={inputCls} /></L>
        <div className="flex justify-end">
          <button onClick={saveFields} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium disabled:opacity-50">
            {saved ? "Saved ✓" : pending ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>

      {/* Line items */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono">Line items</h2>
          <span className="text-sm font-semibold text-bone">Subtotal {money(subtotal)}</span>
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <ItemRow key={it.id} jobId={job.id} item={it} onChange={() => router.refresh()} />
          ))}
        </div>
        <AddItem jobId={job.id} onAdded={() => router.refresh()} />
      </section>

      {/* Billing */}
      <Billing jobId={job.id} invoices={invoices} defaultBiller={defaultBiller} billers={billers} />
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ItemRow({ jobId, item, onChange }: { jobId: number; item: LineItem; onChange: () => void }) {
  const [, start] = useTransition();
  const [d, setD] = useState(item.description);
  const [q, setQ] = useState(String(item.qty));
  const [p, setP] = useState(String(item.unit_price));
  const save = () =>
    start(async () => {
      await updateItemAction(jobId, item.id, {
        description: d,
        qty: Number(q) || 0,
        unit_price: Number(p.replace(/[^0-9.]/g, "")) || 0,
      });
    });
  const del = () => start(async () => {
    await deleteItemAction(jobId, item.id);
    onChange();
  });
  return (
    <div className="flex items-center gap-1.5">
      <input value={d} onChange={(e) => setD(e.target.value)} onBlur={save} className={`${inputCls} flex-1`} />
      <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={save} inputMode="decimal" className={`${inputCls} w-12 text-center px-1`} />
      <input value={p} onChange={(e) => setP(e.target.value)} onBlur={save} inputMode="decimal" className={`${inputCls} w-20 px-2`} />
      <button onClick={del} aria-label="Remove" className="shrink-0 w-8 h-8 grid place-items-center text-warmred">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function AddItem({ jobId, onAdded }: { jobId: number; onAdded: () => void }) {
  const [, start] = useTransition();
  const [d, setD] = useState("");
  const [q, setQ] = useState("1");
  const [p, setP] = useState("");
  function add() {
    if (!d.trim()) return;
    start(async () => {
      await addItemAction(jobId, d.trim(), Number(q) || 1, Number(p.replace(/[^0-9.]/g, "")) || 0);
      setD("");
      setQ("1");
      setP("");
      onAdded();
    });
  }
  return (
    <div className="flex items-center gap-1.5">
      <input value={d} onChange={(e) => setD(e.target.value)} placeholder="Add item…" className={`${inputCls} flex-1`} />
      <input value={q} onChange={(e) => setQ(e.target.value)} inputMode="decimal" className={`${inputCls} w-12 text-center px-1`} />
      <input value={p} onChange={(e) => setP(e.target.value)} inputMode="decimal" placeholder="$" className={`${inputCls} w-20 px-2`} />
      <button onClick={add} aria-label="Add" className="shrink-0 w-8 h-8 grid place-items-center rounded-lg gradient-fill text-bone">
        <Plus size={16} />
      </button>
    </div>
  );
}

function Billing({
  jobId,
  invoices,
  defaultBiller,
  billers,
}: {
  jobId: number;
  invoices: InvoiceView[];
  defaultBiller: "tps" | "sharpline";
  billers: Biller[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [biller, setBiller] = useState<"tps" | "sharpline">(defaultBiller);
  const [open, setOpen] = useState<number | null>(invoices[0]?.id ?? null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payUrls, setPayUrls] = useState<Record<number, string>>(() =>
    Object.fromEntries(invoices.filter((i) => i.stripeUrl).map((i) => [i.id, i.stripeUrl as string])),
  );
  const [copied, setCopied] = useState<number | null>(null);

  function payLink(invoiceId: number) {
    setErr(null);
    start(async () => {
      const r = await createPaymentLinkAction(jobId, invoiceId);
      if (!r.ok) setErr(r.error || "Couldn't create pay link");
      else setPayUrls((p) => ({ ...p, [invoiceId]: r.url! }));
    });
  }
  async function copy(invoiceId: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(invoiceId);
      setTimeout(() => setCopied((c) => (c === invoiceId ? null : c)), 1500);
    } catch {
      /* clipboard may be blocked; the link is visible to copy by hand */
    }
  }

  function create(kind: "estimate" | "invoice") {
    setErr(null);
    start(async () => {
      const r = await createInvoiceAction(jobId, kind, biller);
      if (!r.ok) setErr(r.error || "Failed");
      else {
        setOpen(r.id ?? null);
        router.refresh();
      }
    });
  }
  function send(invoiceId: number) {
    setSentMsg(null);
    start(async () => {
      const r = await sendInvoiceAction(jobId, invoiceId);
      setSentMsg(r.msg || "");
      router.refresh();
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono">Billing</h2>
      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">
          Bills as {biller === defaultBiller ? "(auto)" : "(overridden)"}
        </span>
        <select value={biller} onChange={(e) => setBiller(e.target.value as "tps" | "sharpline")} className={`${inputCls} mt-1`}>
          {billers.map((b) => (
            <option key={b.key} value={b.key}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button onClick={() => create("estimate")} disabled={pending} className="flex-1 px-3 py-2 rounded-lg border border-border text-bone-dim hover:text-bone text-sm disabled:opacity-50">
          Estimate
        </button>
        <button onClick={() => create("invoice")} disabled={pending} className="flex-1 gradient-pill px-3 py-2 text-sm font-medium disabled:opacity-50">
          Invoice
        </button>
      </div>
      {err && <p className="text-xs text-warmred font-mono">{err}</p>}

      <div className="space-y-2 pt-1">
        {invoices.map((inv) => (
          <div key={inv.id} className="rounded-xl border border-border bg-surface/40 overflow-hidden">
            <button
              onClick={() => setOpen(open === inv.id ? null : inv.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
            >
              <FileText size={15} className="text-bone-dim shrink-0" />
              <span className="font-medium text-bone">{inv.number}</span>
              <span className={`text-[10px] font-mono uppercase tracking-wider ${inv.status === "paid" ? "text-green-400" : inv.status === "sent" ? "text-periwinkle" : "text-bone-mute"}`}>
                {inv.status}
              </span>
              <span className="ml-auto font-semibold text-bone">{money(inv.total)}</span>
            </button>
            {open === inv.id && (
              <div className="px-3 pb-3 space-y-2">
                <pre className="text-[12px] text-bone-dim whitespace-pre-wrap font-mono bg-surface-2 rounded-lg p-3 border border-border">
                  {inv.text}
                </pre>
                {sentMsg && <p className="text-[12px] text-periwinkle font-mono flex items-center gap-1"><Check size={12} />{sentMsg}</p>}
                <div className="flex items-center gap-2">
                  <a
                    href={`/invoice/${inv.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border text-bone-dim hover:text-bone text-sm"
                  >
                    <FileText size={14} /> View / Print
                  </a>
                  <button
                    onClick={() => send(inv.id)}
                    disabled={pending || inv.status === "sent" || inv.status === "paid"}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 gradient-pill px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    <Send size={14} /> {inv.status === "sent" ? "Sent" : "Text client"}
                  </button>
                </div>
                {/* Pay by card (invoices only) */}
                {inv.kind === "invoice" && inv.status !== "paid" && (
                  payUrls[inv.id] ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <CreditCard size={14} className="text-green-400 shrink-0" />
                      <a href={payUrls[inv.id]} target="_blank" rel="noopener noreferrer" className="text-[12px] text-periwinkle font-mono truncate flex-1">
                        {payUrls[inv.id]}
                      </a>
                      <button onClick={() => copy(inv.id, payUrls[inv.id])} className="text-bone-dim hover:text-bone shrink-0">
                        {copied === inv.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => payLink(inv.id)}
                      disabled={pending}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-border text-bone-dim hover:text-bone text-sm disabled:opacity-50"
                    >
                      <CreditCard size={14} /> Create pay-by-card link
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
