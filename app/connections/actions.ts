"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { providerById } from "@/lib/connections";

// Add a source. Secret fields go to the `secret` column (never returned to the
// client); everything else to `config`. OAuth providers start 'pending' (they
// need a desktop auth step); phone-completable ones start 'active'.
export async function addConnection(
  providerId: string,
  label: string,
  values: Record<string, string>,
) {
  const provider = providerById(providerId);
  if (!provider) return { ok: false, error: "Unknown source type." };

  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const f of provider.fields) {
    const raw = (values[f.key] ?? "").trim();
    if (f.required && !raw && !f.secret) {
      return { ok: false, error: `${f.label} is required.` };
    }
    if (f.required && !raw && f.secret && !provider.needsDesktop) {
      return { ok: false, error: `${f.label} is required.` };
    }
    if (!raw) continue;
    (f.secret ? secret : config)[f.key] = raw;
  }

  const name = (label || "").trim() || provider.name;
  const status = provider.needsDesktop ? "pending" : "active";

  const db = getDb();
  db.prepare(
    `INSERT INTO connections (kind, provider, label, status, config, secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    provider.kind,
    provider.id,
    name,
    status,
    Object.keys(config).length ? JSON.stringify(config) : null,
    Object.keys(secret).length ? JSON.stringify(secret) : null,
  );
  revalidatePath("/connections");
  return { ok: true };
}

export async function deleteConnection(id: number) {
  const db = getDb();
  db.prepare(`DELETE FROM connections WHERE id = ?`).run(id);
  revalidatePath("/connections");
  return { ok: true };
}

// Flip active <-> disabled (pending/error are left for the per-provider wiring).
export async function toggleConnection(id: number) {
  const db = getDb();
  const row = db.prepare(`SELECT status FROM connections WHERE id = ?`).get(id) as
    | { status: string }
    | undefined;
  if (!row) return { ok: false, error: "Not found." };
  const next =
    row.status === "active" ? "disabled" : row.status === "disabled" ? "active" : row.status;
  db.prepare(`UPDATE connections SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    next,
    id,
  );
  revalidatePath("/connections");
  return { ok: true };
}
