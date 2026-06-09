// Shared date/time helpers — used by BOTH the chat tool (lib/nillad-tools.ts)
// and the /reminders UI so the two paths store `due_at` identically.
//
// Storage convention: reminders are stored as America/Denver ISO 8601 WITH an
// explicit offset, e.g. "2026-06-08T13:20:00-06:00". The n8n dispatcher runs
// `datetime(due_at) <= datetime('now')` and SQLite's datetime() normalizes an
// offset-bearing string to UTC — so reminders fire at the correct instant.
// A naive "2026-06-08 19:20:00" (no offset) is ambiguous: SQLite reads it as
// UTC while JS `new Date()` reads it as local, which is the bug this fixes.
//
// Pure module (only Intl/Date) — safe to import from client components.

export const TZ = "America/Denver";

// America/Denver UTC offset (e.g. "-06:00" summer / "-07:00" winter) for an
// instant, via Intl so DST is handled without a tz library.
export function denverOffset(d: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT-06:00"
  const off = (name || "GMT+00:00").replace("GMT", "");
  return off || "+00:00";
}

// Format an absolute instant as Denver-local ISO 8601 WITH offset.
export function toDenverIso(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  let hh = g("hour");
  if (hh === "24") hh = "00";
  return `${g("year")}-${g("month")}-${g("day")}T${hh}:${g("minute")}:${g("second")}${denverOffset(d)}`;
}

// Friendly Denver-local rendering, e.g. "Mon, Jun 8, 1:20 PM".
export function humanDenver(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// Parse a stored due_at robustly: an offset/Z string is exact; a naive string
// (legacy rows written by the old UI) is treated as UTC, matching how the n8n
// dispatcher's datetime() compares it. Returns a Date (the true instant).
export function parseStored(iso: string): Date {
  const s = iso.trim();
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : s.replace(" ", "T") + "Z");
  return d;
}

// A datetime-local picker value ("YYYY-MM-DDTHH:MM") is a Denver wall-clock time.
// Convert it to a stored Denver-offset ISO, using the offset that applies AT the
// target date (so a reminder set across a DST boundary is still correct).
export function denverInputToIso(local: string): string {
  const rough = new Date(local + "Z"); // treat wall-clock as UTC to get a near instant
  const offset = denverOffset(rough); // Denver offset around that date
  const exact = new Date(local + offset); // reinterpret the wall-clock as Denver
  return toDenverIso(exact);
}

// Inverse: a stored due_at → the "YYYY-MM-DDTHH:MM" Denver wall-clock value a
// datetime-local input expects.
export function isoToDenverInput(iso: string): string {
  const d = parseStored(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  let hh = g("hour");
  if (hh === "24") hh = "00";
  return `${g("year")}-${g("month")}-${g("day")}T${hh}:${g("minute")}`;
}

// Short relative phrase for an instant vs now, e.g. "in 25m", "in 3h",
// "tomorrow", "in 4d", or "now". Used for at-a-glance home suggestions.
export function shortRelative(d: Date): string {
  const ms = d.getTime() - Date.now();
  const past = ms < 0;
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 1) return "now";
  let label: string;
  if (min < 60) label = `${min}m`;
  else if (min < 60 * 36) label = `${Math.round(min / 60)}h`;
  else label = `${Math.round(min / 1440)}d`;
  return past ? `${label} ago` : `in ${label}`;
}

// Accept ISO 8601 (with/without offset) or "in N minutes/hours/days". Returns the
// stored Denver-offset ISO plus a human-friendly Denver time for confirmations.
const REL = /^\s*in\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\s*$/i;
export function parseDue(dueAt: string): { iso: string; when: string; date: Date } {
  const m = REL.exec(dueAt);
  let d: Date;
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const secs = unit.startsWith("d") ? 86400 : unit.startsWith("h") ? 3600 : 60;
    d = new Date(Date.now() + n * secs * 1000);
  } else {
    let s = dueAt.trim().replace(" ", "T");
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
    // A naive timestamp from the model means Denver wall-clock; pin the offset so
    // it isn't parsed as the container's UTC.
    if (!hasTz) s = s + denverOffset(new Date());
    d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`Could not parse due_at=${JSON.stringify(dueAt)}`);
  }
  return { iso: toDenverIso(d), when: humanDenver(d), date: d };
}
