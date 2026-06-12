"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, X, Repeat, Loader2 } from "lucide-react";
import { addGeoReminder, removeGeoReminder } from "./actions";

export type GeoRow = {
  id: number;
  place: string;
  text: string;
  repeat: number;
  last_fired_at: string | null;
};

export function GeoReminders({ rows }: { rows: GeoRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState("");
  const [text, setText] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>) {
    startTransition(async () => {
      await fn();
      router.refresh();
    });
  }

  function add() {
    if (!place.trim() || !text.trim()) return;
    const p = place.trim();
    const t = text.trim();
    const r = repeat;
    setPlace("");
    setText("");
    setRepeat(false);
    setOpen(false);
    run(() => addGeoReminder(p, t, r));
  }

  return (
    <section className="px-4 pt-2 pb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">
          <MapPin size={12} /> Location reminders
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-periwinkle-soft hover:text-periwinkle"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {open && (
        <div className="rounded-2xl border border-border bg-surface p-3 mb-2 space-y-2">
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Place (e.g. Lehi site, Home Depot)"
            className="w-full rounded-lg bg-bg border border-border px-3 py-2 text-sm text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle"
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Remind me to…"
            className="w-full rounded-lg bg-bg border border-border px-3 py-2 text-sm text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => setRepeat((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-xs ${repeat ? "text-periwinkle-soft" : "text-bone-mute"}`}
            >
              <Repeat size={13} /> {repeat ? "Every arrival" : "One-time"}
            </button>
            <button
              onClick={add}
              disabled={pending || !place.trim() || !text.trim()}
              className="gradient-pill px-4 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-bone-dim">
          Ping yourself when you arrive somewhere — e.g. “check the trim” at the Lehi site. Needs the
          one-time iOS Arrive shortcut.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((g) => (
            <li
              key={g.id}
              className="group flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <MapPin size={15} className="mt-0.5 shrink-0 text-periwinkle-soft" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-bone">{g.text}</div>
                <div className="text-[11px] text-bone-mute">
                  at {g.place}
                  {g.repeat ? " · repeats" : ""}
                  {g.last_fired_at ? " · fired before" : ""}
                </div>
              </div>
              <button
                onClick={() => run(() => removeGeoReminder(g.id))}
                disabled={pending}
                aria-label="Remove"
                className="w-7 h-7 grid place-items-center rounded-md text-bone-mute opacity-0 group-hover:opacity-100 hover:text-warmred transition"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
