import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { parseVCards, type ParsedContact } from "@/lib/vcard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bulk-import contacts. Two body shapes:
//   { vcard: "<.vcf text>" }            — from the in-app upload button
//   { contacts: [{name,phone,email}] }  — from an iOS Shortcut posting JSON
// Auth: a logged-in session cookie OR ?key=NF_SESSION_SECRET (so a Shortcut, which
// has no cookie, can still post). Dedupes against existing contacts by E.164 phone.
export async function POST(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-import-key") || "";
  const keyOk = !!process.env.NF_SESSION_SECRET && key === process.env.NF_SESSION_SECRET;
  if (!keyOk && !(await isAuthed())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { vcard?: string; contacts?: ParsedContact[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad body." }, { status: 400 });
  }

  let parsed: ParsedContact[] = [];
  if (typeof body.vcard === "string" && body.vcard.includes("VCARD")) {
    parsed = parseVCards(body.vcard);
  } else if (Array.isArray(body.contacts)) {
    // An iOS Shortcut often hands a contact's phone/email back as a LIST — take the
    // first entry. Also tolerate values arriving as numbers.
    const first = (v: unknown): string =>
      Array.isArray(v) ? String(v[0] ?? "").trim() : v == null ? "" : String(v).trim();
    parsed = body.contacts
      .map((c) => ({ name: first(c?.name), phone: first(c?.phone), email: first(c?.email) }))
      .filter((c) => c.name || c.phone);
  } else {
    return Response.json({ error: "Provide `vcard` text or a `contacts` array." }, { status: 400 });
  }

  const db = getDb();
  // Existing phones (normalized) so we don't create duplicates.
  const existing = new Set(
    (db.prepare(`SELECT phone FROM contacts WHERE phone IS NOT NULL`).all() as { phone: string }[])
      .map((r) => toE164(r.phone) || r.phone)
      .filter(Boolean),
  );

  const insert = db.prepare(
    `INSERT INTO contacts (name, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
  );

  let imported = 0;
  let skipped = 0;
  const seenThisRun = new Set<string>();
  const tx = db.transaction((rows: ParsedContact[]) => {
    for (const c of rows) {
      const name = c.name.trim() || null;
      const phoneNorm = c.phone ? toE164(c.phone) || c.phone.trim() : null;
      const email = c.email.trim() || null;
      if (!name && !phoneNorm) {
        skipped++;
        continue;
      }
      // Dedupe by phone (against DB + within this file). Phone-less contacts always import.
      if (phoneNorm) {
        if (existing.has(phoneNorm) || seenThisRun.has(phoneNorm)) {
          skipped++;
          continue;
        }
        seenThisRun.add(phoneNorm);
      }
      insert.run(name, phoneNorm, email);
      imported++;
    }
  });
  tx(parsed);

  return Response.json({ ok: true, imported, skipped, found: parsed.length });
}
