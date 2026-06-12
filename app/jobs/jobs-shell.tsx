"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Sparkles, Briefcase } from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import { createJobAction, createFromActivityAction } from "./actions";

export type JobListRow = {
  id: number;
  title: string | null;
  client: string | null;
  contact_name: string | null;
  status: string | null;
  quoted_price: number | null;
  items_total: number;
  paid: number;
};
export type ActivityOption = { id: number; title: string };

const STATUS_COLOR: Record<string, string> = {
  lead: "text-bone-mute",
  quoted: "text-periwinkle",
  scheduled: "text-periwinkle",
  active: "text-amber-400",
  done: "text-amber-400",
  invoiced: "text-periwinkle",
  paid: "text-green-400",
};
const money = (n: number | null) => (n == null ? "" : `$${n.toFixed(2)}`);

export function JobsShell({ rows, activities }: { rows: JobListRow[]; activities: ActivityOption[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <ul className="px-4 py-3 space-y-2">
        {rows.length === 0 && (
          <li className="text-center text-xs text-bone-dim font-mono py-10">
            No jobs yet. Tap + to create one, or seed from an activity.
          </li>
        )}
        {rows.map((j) => {
          const price = j.quoted_price ?? (j.items_total || null);
          return (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
              >
                <div className="w-9 h-9 shrink-0 grid place-items-center rounded-lg bg-surface-2 text-bone-dim">
                  <Briefcase size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-bone truncate">{j.title || j.client || "(untitled job)"}</div>
                  <div className="text-[12px] text-bone-dim truncate">
                    <span className={STATUS_COLOR[j.status || "lead"] || "text-bone-mute"}>{j.status || "lead"}</span>
                    {j.contact_name ? ` · ${j.contact_name}` : ""}
                    {price ? ` · ${money(price)}` : ""}
                  </div>
                </div>
                {j.paid ? (
                  <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-green-400">paid</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <button
        onClick={() => setCreating(true)}
        aria-label="New job"
        className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center z-10 shadow-lg"
        style={{ background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)", boxShadow: "0 8px 24px rgba(98,92,200,0.35)" }}
      >
        <Plus size={22} className="text-bone" />
      </button>

      {creating && <CreateSheet activities={activities} onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateSheet({ activities, onClose }: { activities: ActivityOption[]; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  const [quoted, setQuoted] = useState("");
  const [activityId, setActivityId] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const inputCls =
    "w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle";

  function createBlank() {
    setErr(null);
    start(async () => {
      const r = await createJobAction({
        title: title || null,
        client: client || null,
        location: location || null,
        quoted_price: quoted ? Number(quoted.replace(/[^0-9.]/g, "")) : null,
        status: "lead",
      });
      if (r.ok) router.push(`/jobs/${r.id}`);
    });
  }
  function fromActivity() {
    if (!activityId) return;
    setErr(null);
    start(async () => {
      const r = await createFromActivityAction(Number(activityId));
      if (r.ok && r.id) router.push(`/jobs/${r.id}`);
      else setErr(r.error || "Failed");
    });
  }

  return (
    <Sheet title="New job" onClose={onClose}>
      <div className="space-y-4">
        {activities.length > 0 && (
          <div className="rounded-xl border border-border bg-surface/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono">
              <Sparkles size={12} /> Seed from an activity
            </div>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={inputCls}>
              <option value="">— pick an activity —</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
            <button
              onClick={fromActivity}
              disabled={pending || !activityId}
              className="w-full gradient-pill px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {pending ? "Reading…" : "Create from activity"}
            </button>
            <p className="text-[11px] text-bone-mute">Nillad pulls the name, address & scope from the activity's notes.</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-bone-mute font-mono">Or enter manually</div>
          <Field label="Job name">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen repaint" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client">
              <input value={client} onChange={(e) => setClient(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Quoted $">
              <input value={quoted} onChange={(e) => setQuoted(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
            </Field>
          </div>
          <Field label="Address">
            <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} />
          </Field>
          {err && <p className="text-xs text-warmred font-mono">{err}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="text-bone-dim text-sm">Cancel</button>
            <button onClick={createBlank} disabled={pending} className="gradient-pill px-5 py-2 text-sm font-medium disabled:opacity-50">
              {pending ? "Creating…" : "Create job"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
