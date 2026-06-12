// Nightly backup of nillad.db — the single highest-ROI reliability add. Nillad's
// entire brain (jobs, invoices, emails, contacts, memory, reminders) is ONE SQLite
// file at /vault/nillad.db; if it corrupts, it's all gone. This takes a consistent
// online snapshot (better-sqlite3's .backup() = safe even while the DB is in use —
// NOT a raw file copy, which can tear a row mid-write) into the vault's Backups
// folder, optionally mirrors it to a second disk, prunes old ones, and pings ntfy.
//
// Called by the n8n cron (nilbackupcron01) nightly and runnable by hand via
// GET/POST /api/backup/run?key=<NF_SESSION_SECRET>.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { VAULT_ROOT } from "@/lib/vault";
import { pushNtfy } from "@/lib/notify";

const DB_PATH = process.env.NILLAD_DB || path.join(VAULT_ROOT, "nillad.db");

// Primary backups live inside the vault (synced, visible in Obsidian, on the host
// disk). A second copy goes to NILLAD_BACKUP_DIR2 if set + writable (a second disk
// mounted into the container) — off-disk protection against a drive failure.
const PRIMARY_DIR = path.join(VAULT_ROOT, "Backups", "nillad");
const SECONDARY_DIR = process.env.NILLAD_BACKUP_DIR2 || "";

const KEEP = Number(process.env.NILLAD_BACKUP_KEEP || 30); // daily snapshots to retain
const PREFIX = "nillad-";
const SUFFIX = ".db";

// Filename-safe local timestamp (container TZ = America/Denver): nillad-2026-06-10_163700.db
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// Keep the newest KEEP backups in a dir, delete the rest. Sorted by name, which is
// chronological because the timestamp is zero-padded.
function prune(dir: string): string[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort(); // ascending: oldest first
  } catch {
    return [];
  }
  const removed: string[] = [];
  while (files.length > KEEP) {
    const victim = files.shift()!;
    try {
      fs.unlinkSync(path.join(dir, victim));
      removed.push(victim);
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

export type BackupResult = {
  ok: boolean;
  file: string;
  bytes: number;
  mirrored: boolean;
  pruned: number;
  error?: string;
};

export async function runBackup(): Promise<BackupResult> {
  const filename = `${PREFIX}${stamp(new Date())}${SUFFIX}`;
  ensureDir(PRIMARY_DIR);
  const dest = path.join(PRIMARY_DIR, filename);

  // Online snapshot via SQLite's backup API (consistent point-in-time, no tearing).
  // Open a throwaway read connection so we never disturb the app's singleton.
  const src = new Database(DB_PATH, { readonly: true });
  try {
    await src.backup(dest);
  } finally {
    src.close();
  }

  const bytes = fs.statSync(dest).size;

  // Mirror off-disk if a second destination is configured + reachable.
  let mirrored = false;
  if (SECONDARY_DIR) {
    try {
      ensureDir(SECONDARY_DIR);
      fs.copyFileSync(dest, path.join(SECONDARY_DIR, filename));
      prune(SECONDARY_DIR);
      mirrored = true;
    } catch {
      /* secondary is best-effort; primary already succeeded */
    }
  }

  const pruned = prune(PRIMARY_DIR).length;

  await pushNtfy(
    "nillad-backup",
    "Nillad backup ✓",
    `${filename} · ${(bytes / 1024).toFixed(0)} KB${mirrored ? " · mirrored off-disk" : ""}`,
    { tags: "floppy_disk", priority: 2 },
  );

  return { ok: true, file: filename, bytes, mirrored, pruned };
}
