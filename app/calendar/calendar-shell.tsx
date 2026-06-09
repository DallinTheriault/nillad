"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, CalendarOff, MapPin, Clock, Bell, Check, ChevronDown } from "lucide-react";
import { createEvent, updateEvent, cancelEvent } from "./actions";
import { isoToDenverInput, parseStored } from "@/lib/datetime";
import { Sheet, Field } from "@/components/sheet";

export type EventRow = {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  description: string | null;
  status: string; // 'confirmed' | 'cancelled'
  dayKey: string;
};
export type ReminderLite = {
  id: number;
  text: string;
  due_at: string;
  status: string;
  dayKey: string;
};
export type DayCell = { key: string; day: number; inMonth: boolean; isToday: boolean };

const EVT_UPCOMING = "#C8A24A"; // amber — upcoming event
const EVT_DONE = "#5FA877"; // green — event that has passed (completed)
const REM_DOT = "#625CC8"; // periwinkle — pending reminder

function isPast(e: EventRow): boolean {
  return parseStored(e.end_at || e.start_at).getTime() < Date.now();
}
function eventColor(e: EventRow): string {
  return isPast(e) ? EVT_DONE : EVT_UPCOMING;
}
function clock(iso: string): string {
  return parseStored(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function longDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function CalendarShell({
  monthLabel,
  prevHref,
  nextHref,
  isCurrent,
  days,
  events,
  reminders,
}: {
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  isCurrent: boolean;
  days: DayCell[];
  events: EventRow[];
  reminders: ReminderLite[];
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | "new" | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const evByDay = new Map<string, EventRow[]>();
  for (const e of events) (evByDay.get(e.dayKey) ?? evByDay.set(e.dayKey, []).get(e.dayKey)!).push(e);
  const remByDay = new Map<string, ReminderLite[]>();
  for (const r of reminders) (remByDay.get(r.dayKey) ?? remByDay.set(r.dayKey, []).get(r.dayKey)!).push(r);

  const dayAll = openDay ? evByDay.get(openDay) ?? [] : [];
  const dayActive = dayAll.filter((e) => e.status === "confirmed").sort((a, b) => a.start_at.localeCompare(b.start_at));
  const dayCancelled = dayAll.filter((e) => e.status === "cancelled");
  const dayReminders = openDay ? remByDay.get(openDay) ?? [] : [];

  return (
    <>
      <div className="px-4 pb-3 flex items-center justify-between">
        <div className="text-lg font-semibold text-bone">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Link href={prevHref} aria-label="Previous month" className="w-8 h-8 grid place-items-center rounded-full border border-border text-bone-dim hover:text-bone transition">
            <ChevronLeft size={16} />
          </Link>
          {!isCurrent && (
            <Link href="/calendar" className="px-3 h-8 grid place-items-center rounded-full border border-border text-xs text-bone-dim hover:text-bone transition">
              Today
            </Link>
          )}
          <Link href={nextHref} aria-label="Next month" className="w-8 h-8 grid place-items-center rounded-full border border-border text-bone-dim hover:text-bone transition">
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 px-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center text-[10px] uppercase tracking-wider text-bone-mute font-mono py-1">
            {d[0]}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 px-2">
        {days.map((cell) => {
          const evs = (evByDay.get(cell.key) ?? []).filter((e) => e.status === "confirmed");
          const rems = remByDay.get(cell.key) ?? [];
          const total = evs.length + rems.length;
          return (
            <button
              key={cell.key}
              onClick={() => {
                setShowCancelled(false);
                setOpenDay(cell.key);
              }}
              className={`min-h-[68px] text-left rounded-lg p-1 transition-colors ${
                cell.inMonth ? "bg-surface/40 hover:bg-surface active:bg-surface" : "bg-transparent"
              } ${cell.isToday ? "ring-1 ring-inset ring-periwinkle/60" : ""}`}
            >
              <div className={`text-[11px] font-mono ${cell.isToday ? "text-periwinkle font-bold" : cell.inMonth ? "text-bone-dim" : "text-bone-mute/40"}`}>
                {cell.day}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {evs.slice(0, 2).map((e) => (
                  <li key={`e${e.id}`} className={`flex items-center gap-1 text-[10px] leading-tight ${isPast(e) ? "text-bone-mute line-through decoration-bone-mute/40" : "text-bone"}`}>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: eventColor(e) }} />
                    <span className="truncate">{e.title}</span>
                  </li>
                ))}
                {rems.slice(0, Math.max(3 - Math.min(evs.length, 2), 0)).map((r) => (
                  <li key={`r${r.id}`} className="flex items-center gap-1 text-[10px] leading-tight text-bone-dim">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: REM_DOT }} />
                    <span className="truncate">{r.text}</span>
                  </li>
                ))}
                {total > 3 && <li className="text-[10px] text-bone-mute pl-2.5">+{total - 3}</li>}
              </ul>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-bone-mute font-mono mt-4 px-4">
        <span style={{ color: EVT_UPCOMING }}>●</span> upcoming · <span style={{ color: EVT_DONE }}>●</span> done · <span style={{ color: REM_DOT }}>●</span> reminder · tap a day
      </p>

      {/* Day view */}
      {openDay && (
        <Sheet title={longDay(openDay)} onClose={() => setOpenDay(null)}>
          <div className="space-y-2">
            {dayActive.length === 0 && dayReminders.length === 0 && dayCancelled.length === 0 && (
              <p className="text-sm text-bone-dim py-4 text-center">Nothing scheduled.</p>
            )}

            {dayActive.map((e) => {
              const done = isPast(e);
              return (
                <button
                  key={e.id}
                  onClick={() => setEditing(e)}
                  className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
                >
                  <span className="mt-1.5 w-1 self-stretch rounded-full" style={{ background: eventColor(e) }} />
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${done ? "text-bone-dim" : "text-bone"}`}>{e.title}</div>
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] font-mono text-bone-dim">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        {clock(e.start_at)}
                        {e.end_at ? `–${clock(e.end_at)}` : ""}
                      </span>
                      {e.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={11} />
                          {e.location}
                        </span>
                      )}
                      {done && (
                        <span className="inline-flex items-center gap-0.5" style={{ color: EVT_DONE }}>
                          <Check size={11} /> completed
                        </span>
                      )}
                    </div>
                    {e.description && <p className="text-xs text-bone-mute mt-1 line-clamp-2">{e.description}</p>}
                  </div>
                </button>
              );
            })}

            {dayReminders.map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-surface/20">
                <span className="mt-1.5 w-1 self-stretch rounded-full" style={{ background: REM_DOT }} />
                <div className="flex-1 min-w-0">
                  <div className="text-bone truncate">{r.text}</div>
                  <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-bone-mute">
                    <span className="inline-flex items-center gap-1">
                      <Bell size={11} />
                      {clock(r.due_at)}
                    </span>
                    <span className="uppercase tracking-wider">reminder</span>
                  </div>
                </div>
              </div>
            ))}

            {dayCancelled.length > 0 && (
              <div className="pt-1">
                <button
                  onClick={() => setShowCancelled((v) => !v)}
                  className="w-full flex items-center justify-between px-1 py-2 text-[11px] font-mono uppercase tracking-wider text-bone-mute hover:text-bone-dim transition"
                >
                  <span>Cancelled · {dayCancelled.length}</span>
                  <ChevronDown size={14} className={`transition-transform ${showCancelled ? "rotate-180" : ""}`} />
                </button>
                {showCancelled && (
                  <div className="space-y-2 mt-1">
                    {dayCancelled.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border/60 bg-surface/10 opacity-60">
                        <span className="mt-1.5 w-1 self-stretch rounded-full bg-warmred-dim" />
                        <div className="flex-1 min-w-0">
                          <div className="text-bone-dim truncate line-through decoration-bone-mute/50">{e.title}</div>
                          <div className="text-[11px] font-mono text-bone-mute mt-0.5">{clock(e.start_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setEditing("new")}
            className="mt-4 w-full gradient-pill py-2.5 text-sm font-medium tracking-wide flex items-center justify-center gap-1.5"
          >
            <Plus size={16} /> Add event
          </button>
        </Sheet>
      )}

      {editing && (
        <EventEditor
          event={editing === "new" ? undefined : editing}
          presetDate={editing === "new" ? openDay ?? undefined : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function defaultStart(presetDate?: string): string {
  if (presetDate) return `${presetDate}T09:00`;
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return isoToDenverInput(d.toISOString());
}

function EventEditor({ event, presetDate, onClose }: { event?: EventRow; presetDate?: string; onClose: () => void }) {
  const router = useRouter();
  const editingExisting = !!event;
  const [title, setTitle] = useState(event?.title ?? "");
  const [start, setStart] = useState(event ? isoToDenverInput(event.start_at) : defaultStart(presetDate));
  const [end, setEnd] = useState(event?.end_at ? isoToDenverInput(event.end_at) : "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fields = { title, start_local: start, end_local: end || undefined, location, description };
      const r = editingExisting ? await updateEvent(event!.id, fields) : await createEvent(fields);
      if (r.ok) {
        router.refresh();
        onClose();
      } else setError(r.error || "Failed");
    });
  }
  function remove() {
    startTransition(async () => {
      await cancelEvent(event!.id);
      router.refresh();
      onClose();
    });
  }

  return (
    <Sheet title={editingExisting ? "Edit event" : "New event"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cars & Coffee" autoFocus className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg bg-surface border border-border px-2 py-2 text-bone text-sm outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle" />
          </Field>
          <Field label="Ends (optional)">
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg bg-surface border border-border px-2 py-2 text-bone text-sm outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle" />
          </Field>
        </div>
        <Field label="Location (optional)">
          <div className="flex items-center gap-2 rounded-lg bg-surface border border-border px-3 focus-within:border-periwinkle focus-within:ring-1 focus-within:ring-periwinkle">
            <MapPin size={14} className="text-bone-mute shrink-0" />
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where" className="w-full bg-transparent py-2 text-bone placeholder:text-bone-mute outline-none" />
          </div>
        </Field>
        <Field label="Notes (optional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Details" className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle resize-none" />
        </Field>
        <div className="flex items-center justify-between pt-2 gap-3">
          {editingExisting ? (
            <button type="button" onClick={remove} disabled={pending} className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft transition">
              <CalendarOff size={14} /> Delete
            </button>
          ) : (
            <button type="button" onClick={onClose} className="text-bone-dim text-sm hover:text-bone transition">
              Cancel
            </button>
          )}
          <button type="submit" disabled={pending || !title.trim()} className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide">
            {pending ? "Saving…" : editingExisting ? "Save" : "Add event"}
          </button>
        </div>
        {error && <p className="text-xs text-warmred font-mono text-center">{error}</p>}
      </form>
    </Sheet>
  );
}
