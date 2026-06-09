"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { toE164 } from "@/lib/phone";

export type ContactFields = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

function clean(s?: string): string | null {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

// Store E.164 when we can normalize, else keep the raw input so nothing is lost.
function normPhone(raw: string | null): string | null {
  if (!raw) return null;
  return toE164(raw) ?? raw;
}

export async function createContact(fields: ContactFields) {
  const name = clean(fields.name);
  const phone = normPhone(clean(fields.phone));
  if (!name && !phone)
    return { ok: false as const, error: "Add a name or phone at minimum." };

  const db = getDb();
  // created_at/updated_at set explicitly — the pre-existing contacts table
  // has no column defaults.
  const info = db
    .prepare(
      `INSERT INTO contacts (name, phone, email, address, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .run(name, phone, clean(fields.email), clean(fields.address), clean(fields.notes));

  revalidatePath("/contacts");
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

export async function updateContact(id: number, fields: ContactFields) {
  const name = clean(fields.name);
  const phone = normPhone(clean(fields.phone));
  if (!name && !phone)
    return { ok: false as const, error: "Add a name or phone at minimum." };

  const db = getDb();
  db.prepare(
    `UPDATE contacts
     SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(name, phone, clean(fields.email), clean(fields.address), clean(fields.notes), id);

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { ok: true as const };
}

export async function archiveContact(id: number) {
  const db = getDb();
  db.prepare(
    `UPDATE contacts SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
  ).run(id);
  revalidatePath("/contacts");
  return { ok: true as const };
}
