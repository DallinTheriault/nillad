import Database from "better-sqlite3";

const DB_PATH = process.env.NILLAD_DB || "./nillad.db";

// Singleton — Node module caching keeps this alive across requests in dev.
declare global {
  // eslint-disable-next-line no-var
  var __nillad_db: Database.Database | undefined;
}

function open(): Database.Database {
  const db = new Database(DB_PATH);
  // NOT WAL. nillad.db is shared across containers (dashboard, n8n, OWUI) over a
  // Docker Desktop Windows bind mount, where WAL's shared-memory (-shm) isn't
  // coherent between containers — a fresh opener (n8n's per-run sqlite3 CLI) then
  // fails with CANTOPEN / disk I/O error, which silently broke reminder dispatch
  // and inbound-SMS logging. Rollback-journal mode needs no -shm and works for
  // every opener. busy_timeout covers the brief writer lock.
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function getDb(): Database.Database {
  if (!global.__nillad_db) {
    global.__nillad_db = open();
  }
  return global.__nillad_db;
}
