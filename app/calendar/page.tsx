import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { parseStored, TZ } from "@/lib/datetime";
import { CalendarShell, type DayCell, type EventRow, type ReminderLite } from "./calendar-shell";

export const dynamic = "force-dynamic";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfGrid(d: Date) {
  const s = startOfMonth(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - s.getDay()); // Sun start
}
function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtMonthYear(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
// The Denver calendar day (yyyy-mm-dd) an instant falls on, regardless of server tz.
function denverDayKey(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const today = new Date();
  const cursor =
    m && /^\d{4}-\d{2}$/.test(m)
      ? new Date(Number(m.split("-")[0]), Number(m.split("-")[1]) - 1, 1)
      : startOfMonth(today);

  const gridStart = startOfGrid(cursor);
  const gridEnd = addDays(gridStart, 42);

  const db = getDb();
  // Calendar shows PENDING reminders only — sent ones already fired and cancelled
  // are dead, so they don't belong on a forward-looking calendar (and this keeps
  // the calendar consistent with what the /reminders page shows).
  const remRows = db
    .prepare(`SELECT id, text, due_at, status FROM reminders WHERE due_at IS NOT NULL AND status='pending' ORDER BY due_at LIMIT 1000`)
    .all() as { id: number; text: string; due_at: string; status: string }[];
  // Fetch confirmed AND cancelled events — cancelled ones live in a collapsed
  // section in the day view rather than vanishing.
  const evRows = db
    .prepare(`SELECT id, title, start_at, end_at, location, description, status FROM calendar_events WHERE status IN ('confirmed','cancelled') ORDER BY start_at LIMIT 1000`)
    .all() as Omit<EventRow, "dayKey">[];

  const inWindow = (iso: string) => {
    const d = parseStored(iso);
    return !Number.isNaN(d.getTime()) && d >= gridStart && d < gridEnd;
  };

  const events: EventRow[] = evRows
    .filter((e) => inWindow(e.start_at))
    .map((e) => ({ ...e, dayKey: denverDayKey(parseStored(e.start_at)) }));
  const reminders: ReminderLite[] = remRows
    .filter((r) => inWindow(r.due_at))
    .map((r) => ({ ...r, dayKey: denverDayKey(parseStored(r.due_at)) }));

  const days: DayCell[] = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    return {
      key: localDayKey(date),
      day: date.getDate(),
      inMonth: date.getMonth() === cursor.getMonth(),
      isToday: sameDay(date, today),
    };
  });

  const prev = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const href = (d: Date) => `/calendar?m=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  return (
    <main className="min-h-dvh max-w-2xl mx-auto pb-28">
      <PageHeader title="Calendar" />
      <CalendarShell
        monthLabel={fmtMonthYear(cursor)}
        prevHref={href(prev)}
        nextHref={href(next)}
        isCurrent={sameDay(cursor, startOfMonth(today))}
        days={days}
        events={events}
        reminders={reminders}
      />
    </main>
  );
}
