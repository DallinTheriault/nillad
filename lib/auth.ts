import crypto from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcrypt";
import { getDb } from "./db";

const COOKIE_NAME = "nf_session";
const SESSION_SECRET =
  process.env.NF_SESSION_SECRET || "change-me-locally-doesnt-matter-much";
const SESSION_TTL_DAYS = 30;

function sign(value: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export type SessionToken = { issued_at: number; sig: string };

function token(issuedAt: number): string {
  return `${issuedAt}.${sign(String(issuedAt))}`;
}

function verifyToken(t: string): boolean {
  const [iss, sig] = t.split(".");
  if (!iss || !sig) return false;
  if (sign(iss) !== sig) return false;
  const issued = Number(iss);
  if (!Number.isFinite(issued)) return false;
  const ageDays = (Date.now() - issued) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= SESSION_TTL_DAYS;
}

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  const t = c.get(COOKIE_NAME)?.value;
  return !!t && verifyToken(t);
}

export async function setSessionCookie() {
  const c = await cookies();
  c.set(COOKIE_NAME, token(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // tailnet HTTP — fine for personal stack
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export function isPinValid(pin: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT pin_hash FROM nf_auth WHERE id = 1")
    .get() as { pin_hash: string } | undefined;
  if (!row) return false; // no PIN set yet — fail closed
  return bcrypt.compareSync(pin, row.pin_hash);
}

export function hasPinSet(): boolean {
  const db = getDb();
  try {
    const row = db
      .prepare("SELECT 1 FROM nf_auth WHERE id = 1")
      .get();
    return !!row;
  } catch {
    return false;
  }
}
