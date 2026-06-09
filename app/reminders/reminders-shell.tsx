"use client";

import { useState, useTransition } from "react";
import { Bell, BellOff, Clock, Plus, RotateCcw } from "lucide-react";
import {
  createReminder,
  updateReminder,
  cancelReminder,
  reactivateReminder,
} from "./actions";
import { parseStored, isoToDenverInput } from "@/lib/datetime";
import { Sheet, Field } from "@/components/sheet";

export type ReminderRow = {
  id: number;
  text: string;
  due_at: string;
  status: "pending" | "sent" | "cancelled";
  created_at: string;
};

type Filter = "pending" | "sent" | "cancelled" | "all";

function fmtDue(iso: string): string {
  const d = parseStored(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function relDelta(iso: string): string {
  const ms = parseStored(iso).getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  const label =
    min < 60 ? `${min}m` : hr < 48 ? `${hr}h` : `${day}d`;
  return past ? `${label} ago` : `in ${label}`;
}

export function RemindersShell({ rows }: { rows: ReminderRow[] }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = rows.filter((r) => filter === "all" || r.status === filter);

  return (
    <>
      <div className="px-4 pt-4 flex items-center gap-2 overflow-x-auto">
        {(["pending", "sent", "cancelled", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-[0.14em] transition ${
              filter === f
                ? "bubble-stroke-gradient text-bone"
                : "border border-border text-bone-dim hover:text-bone"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <ul className="px-4 py-4 space-y-2">
        {visible.length === 0 && (
          <li className="text-xs text-bone-dim font-mono py-6 text-center">
            Nothing in {filter}.
          </li>
        )}
        {visible.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => setEditing(r)}
              className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
            >
              <div
                aria-hidden
                className="mt-1.5 w-1 self-stretch rounded-full"
                style={{
                  background:
                    r.status === "pending"
                      ? "linear-gradient(180deg, #625CC8 0%, #D52F31 100%)"
                      : r.status === "sent"
                        ? "#2C2C36"
                        : "#962023",
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-bone truncate">{r.text}</div>
                <div className="flex items-center gap-3 mt-1 text-[11px] font-mono">
                  <span
                    className={`inline-flex items-center gap-1 ${
                      r.status === "pending" ? "text-bone-dim" : "text-bone-mute"
                    }`}
                  >
                    <Clock size={11} />
                    {fmtDue(r.due_at)}
                  </span>
                  <span className="text-bone-mute">· {relDelta(r.due_at)}</span>
                  <StatusBadge status={r.status} />
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <FloatingAddButton onClick={() => setCreating(true)} />

      {creating && <CreateDrawer onClose={() => setCreating(false)} />}
      {editing && <EditDrawer reminder={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function StatusBadge({ status }: { status: ReminderRow["status"] }) {
  if (status === "pending")
    return (
      <span className="text-periwinkle uppercase tracking-wider">pending</span>
    );
  if (status === "sent")
    return <span className="text-bone-mute uppercase tracking-wider">sent</span>;
  return <span className="text-warmred-dim uppercase tracking-wider">cancelled</span>;
}

function FloatingAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="New reminder"
      className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center z-10 shadow-lg"
      style={{
        background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
        boxShadow: "0 8px 24px rgba(98,92,200,0.35)",
      }}
    >
      <Plus size={22} className="text-bone" />
    </button>
  );
}

function CreateDrawer({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [due, setDue] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000); // default: 1 hour out
    d.setSeconds(0, 0);
    return isoToDenverInput(d.toISOString()); // Denver wall-clock for the picker
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // `due` is the datetime-local (Denver wall-clock) value; the action
      // normalizes it to a Denver-offset ISO. See lib/datetime.ts.
      const r = await createReminder(text, due);
      if (r.ok) onClose();
      else setError(r.error || "Failed");
    });
  }

  return (
    <Sheet title="New reminder" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="What">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Pick up dry cleaning"
            autoFocus
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        <Field label="When">
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        <div className="flex items-center justify-between pt-2 gap-3">
          <button type="button" onClick={onClose} className="text-bone-dim text-sm hover:text-bone transition">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide"
          >
            {pending ? "Saving…" : "Set reminder"}
          </button>
        </div>
        {error && <p className="text-xs text-warmred font-mono text-center">{error}</p>}
      </form>
    </Sheet>
  );
}

function EditDrawer({
  reminder,
  onClose,
}: {
  reminder: ReminderRow;
  onClose: () => void;
}) {
  const [text, setText] = useState(reminder.text);
  // Stored due_at (Denver-offset ISO) → the Denver wall-clock value the picker wants.
  const [due, setDue] = useState(() => isoToDenverInput(reminder.due_at));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await updateReminder(reminder.id, { text, due_local: due });
      if (r.ok) onClose();
      else setError(r.error || "Failed");
    });
  }

  function handleCancel() {
    startTransition(async () => {
      await cancelReminder(reminder.id);
      onClose();
    });
  }
  function handleReactivate() {
    startTransition(async () => {
      await reactivateReminder(reminder.id);
      onClose();
    });
  }

  return (
    <Sheet title={`Edit reminder #${reminder.id}`} onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        <Field label="What">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={reminder.status !== "pending"}
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone disabled:opacity-50 outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        <Field label="When">
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            disabled={reminder.status !== "pending"}
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone disabled:opacity-50 outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        <div className="flex items-center justify-between pt-2 gap-3">
          {reminder.status === "pending" ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft transition"
            >
              <BellOff size={14} /> Cancel
            </button>
          ) : reminder.status === "cancelled" ? (
            <button
              type="button"
              onClick={handleReactivate}
              disabled={pending}
              className="inline-flex items-center gap-1.5 text-periwinkle text-sm hover:text-periwinkle-soft transition"
            >
              <RotateCcw size={14} /> Reactivate
            </button>
          ) : (
            <span className="text-bone-mute text-xs font-mono uppercase tracking-wider">
              already sent
            </span>
          )}
          <button
            type="submit"
            disabled={pending || reminder.status !== "pending"}
            className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-warmred font-mono text-center">{error}</p>}
      </form>
    </Sheet>
  );
}


