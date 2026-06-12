// Location reminders. "Remind me to check the trim when I get to the Lehi site."
// An iOS Shortcut personal automation (When I Arrive at <place>) POSTs to
// /api/location/arrive with the place name; fireArrival() matches active reminders
// by keyword and pushes them via ntfy, deactivating one-shots.

import { getDb } from "@/lib/db";
import { pushNtfy } from "@/lib/notify";

const TOPIC = process.env.NILLAD_GEO_TOPIC || "nillad-reminder";

export type GeoReminder = {
  id: number;
  place: string;
  text: string;
  active: number;
  repeat: number;
  last_fired_at: string | null;
  created_at: string;
};

export function createGeoReminder(place: string, text: string, repeat = false): number {
  const p = place.trim();
  const t = text.trim();
  if (!p || !t) throw new Error("Need a place and a reminder.");
  const info = getDb()
    .prepare(`INSERT INTO geo_reminders (place, text, repeat) VALUES (?, ?, ?)`)
    .run(p, t, repeat ? 1 : 0);
  return Number(info.lastInsertRowid);
}

export function listGeoReminders(includeInactive = false): GeoReminder[] {
  return getDb()
    .prepare(
      `SELECT * FROM geo_reminders ${includeInactive ? "" : "WHERE active=1"} ORDER BY created_at DESC`,
    )
    .all() as GeoReminder[];
}

export function deleteGeoReminder(id: number): void {
  getDb().prepare(`DELETE FROM geo_reminders WHERE id=?`).run(id);
}

// Called when the phone reports arrival at a place. Matches active reminders whose
// place keyword appears in (or contains) the arrival label — forgiving so "Lehi"
// matches "Lehi site" and vice versa. Fires each, deactivating non-repeating ones.
export async function fireArrival(arrivalPlace: string): Promise<{ fired: number }> {
  const place = (arrivalPlace || "").toLowerCase().trim();
  if (!place) return { fired: 0 };
  const db = getDb();
  const active = db.prepare(`SELECT * FROM geo_reminders WHERE active=1`).all() as GeoReminder[];
  let fired = 0;
  for (const r of active) {
    const key = r.place.toLowerCase().trim();
    if (!key) continue;
    if (!(place.includes(key) || key.includes(place))) continue;
    await pushNtfy(TOPIC, `📍 ${r.place}`, r.text, { priority: 4, tags: "round_pushpin" });
    db.prepare(`UPDATE geo_reminders SET last_fired_at=datetime('now')${r.repeat ? "" : ", active=0"} WHERE id=?`).run(
      r.id,
    );
    fired++;
  }
  return { fired };
}
