import type { getDb } from "@/lib/db";

type DB = ReturnType<typeof getDb>;

// Soft-link helpers between contacts and sms_threads (matched by E.164 phone).

// Map of phone -> contact name for the given phones only (one round-trip).
export function contactNamesByPhone(
  db: DB,
  phones: (string | null)[],
): Map<string, string> {
  const map = new Map<string, string>();
  const uniq = [...new Set(phones.filter((p): p is string => !!p))];
  if (uniq.length === 0) return map;
  const placeholders = uniq.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT phone, name FROM contacts
       WHERE archived_at IS NULL AND name IS NOT NULL AND phone IN (${placeholders})`,
    )
    .all(...uniq) as { phone: string; name: string }[];
  for (const r of rows) if (!map.has(r.phone)) map.set(r.phone, r.name);
  return map;
}

export function contactByPhone(
  db: DB,
  phone: string | null,
): { id: number; name: string | null } | undefined {
  if (!phone) return undefined;
  return db
    .prepare(
      `SELECT id, name FROM contacts WHERE archived_at IS NULL AND phone = ? LIMIT 1`,
    )
    .get(phone) as { id: number; name: string | null } | undefined;
}
