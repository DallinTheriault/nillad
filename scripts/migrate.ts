// NF v1 schema migration: creates sms_threads + sms_messages and backfills
// from the existing sms_inbox rows. Idempotent on schema (CREATE IF NOT EXISTS);
// backfill is one-shot and gated by a `nf_migrations` marker row.
//
// Run from the host: `npm run migrate`

import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.NILLAD_DB || "./nillad.db";

console.log(`[migrate] opening ${DB_PATH}`);
const db = new Database(DB_PATH);
// DELETE (rollback journal), not WAL — the DB is shared across containers over a
// Windows bind mount where WAL breaks fresh openers. See lib/db.ts for details.
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS nf_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_threads (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_phone        TEXT NOT NULL UNIQUE,
  display_name         TEXT,
  consent_status       TEXT NOT NULL DEFAULT 'active'
    CHECK (consent_status IN ('active','stopped','help_sent')),
  last_inbound_at      TEXT,
  last_outbound_at     TEXT,
  last_message_at      TEXT,
  last_message_preview TEXT,
  last_read_at         TEXT,
  archived_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_threads_last_msg
  ON sms_threads (last_message_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS sms_messages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id          INTEGER NOT NULL REFERENCES sms_threads(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body               TEXT NOT NULL,
  twilio_message_sid TEXT UNIQUE,
  twilio_status      TEXT,
  error_code         TEXT,
  template_key       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_thread
  ON sms_messages (thread_id, created_at DESC);

-- Keep sms_threads.last_* in sync when a message is inserted.
CREATE TRIGGER IF NOT EXISTS sms_messages_update_thread
AFTER INSERT ON sms_messages
BEGIN
  UPDATE sms_threads
  SET
    last_inbound_at      = CASE WHEN NEW.direction = 'inbound'  THEN NEW.created_at ELSE last_inbound_at  END,
    last_outbound_at     = CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at ELSE last_outbound_at END,
    last_message_at      = NEW.created_at,
    last_message_preview = substr(NEW.body, 1, 200),
    updated_at           = datetime('now')
  WHERE id = NEW.thread_id;
END;

-- Mirror inbound rows from sms_inbox -> sms_threads/sms_messages so the n8n
-- webhook (which writes sms_inbox) doesn't need to be changed yet.
CREATE TRIGGER IF NOT EXISTS sms_inbox_mirror_inbound
AFTER INSERT ON sms_inbox
WHEN NEW.direction = 'in'
BEGIN
  INSERT OR IGNORE INTO sms_threads (contact_phone, created_at)
    VALUES (NEW.from_number, NEW.received_at);
  INSERT OR IGNORE INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
    SELECT id, 'inbound', NEW.body, NEW.message_sid, 'received', NEW.received_at
    FROM sms_threads WHERE contact_phone = NEW.from_number;
END;

-- Contacts (ported from Field's contacts surface, rebuilt local-first).
-- phone is stored E.164 so it soft-links to sms_threads.contact_phone by value.
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Activities = context log + project containers. Each holds freeform notes
-- (the context Nillad reads) and a task checklist. Completed tasks are kept
-- (done=1), not deleted, so the history stays as context.
CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  category    TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  notes       TEXT,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activities_active
  ON activities (updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_activity
  ON tasks (activity_id, done, sort_order);

-- Persisted Nillad chats (so conversations survive reloads + can be resumed).
CREATE TABLE IF NOT EXISTS chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  has_image  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages ON chat_messages (chat_id, id);

-- First-class calendar events (distinct from reminders, which are timed pings).
-- Times are stored as Denver-offset ISO 8601 (see lib/datetime.ts), same as
-- reminders, so display + any future dispatcher logic stay tz-correct.
CREATE TABLE IF NOT EXISTS calendar_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT,
  all_day     INTEGER NOT NULL DEFAULT 0,
  location    TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start
  ON calendar_events (start_at) WHERE status = 'confirmed';

-- Nillad's durable memory: facts/decisions/preferences worth keeping. The chat
-- agent saves + recalls these so it remembers across conversations.
CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject    TEXT NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories (created_at DESC);
`);

console.log("[migrate] schema ensured");

// chat_messages.image — persist the attached image (data URL) so a reloaded chat
// shows the original picture, not just a "📎 image" marker. Nullable add.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("image")) {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN image TEXT`);
    console.log("[migrate] chat_messages: added column image");
  }
}

// Reconcile a pre-existing `contacts` table (older shape lacked these columns).
// ALTER ADD COLUMN can't take a non-constant default, so added columns are
// plain nullable; the actions always set updated_at/created_at explicitly.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(contacts)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  const ensure = (name: string, ddl: string) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE contacts ADD COLUMN ${ddl}`);
      cols.add(name);
      console.log(`[migrate] contacts: added column ${name}`);
    }
  };
  ensure("email", "email TEXT");
  ensure("address", "address TEXT");
  ensure("archived_at", "archived_at TEXT");
  ensure("updated_at", "updated_at TEXT");
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_updated
       ON contacts (updated_at DESC) WHERE archived_at IS NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_contacts_phone
       ON contacts (phone) WHERE archived_at IS NULL`,
  );
}

// Backfill existing sms_inbox inbound rows into the new tables (one-shot).
const hasBackfill = db
  .prepare("SELECT 1 FROM nf_migrations WHERE name = ?")
  .get("backfill_v1_inbound");

if (!hasBackfill) {
  const inboundCount = db
    .prepare("SELECT COUNT(*) AS n FROM sms_inbox WHERE direction = 'in'")
    .get() as { n: number };
  console.log(`[migrate] backfilling ${inboundCount.n} inbound rows from sms_inbox`);

  // First seed threads from distinct senders (use earliest received_at as thread.created_at)
  db.prepare(
    `INSERT OR IGNORE INTO sms_threads (contact_phone, created_at)
     SELECT from_number, MIN(received_at)
     FROM sms_inbox WHERE direction = 'in'
     GROUP BY from_number`,
  ).run();

  // Then insert messages in chronological order so the per-message trigger
  // leaves last_message_at on the most-recent message.
  db.prepare(
    `INSERT OR IGNORE INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
     SELECT
       (SELECT id FROM sms_threads WHERE contact_phone = i.from_number),
       'inbound', i.body, i.message_sid, 'received', i.received_at
     FROM sms_inbox i
     WHERE i.direction = 'in' AND i.from_number IS NOT NULL
     ORDER BY i.received_at ASC`,
  ).run();

  db.prepare("INSERT INTO nf_migrations (name) VALUES (?)").run("backfill_v1_inbound");
  console.log("[migrate] backfill complete");
} else {
  console.log("[migrate] backfill already applied; skipping");
}

const threads = db.prepare("SELECT COUNT(*) AS n FROM sms_threads").get() as { n: number };
const messages = db.prepare("SELECT COUNT(*) AS n FROM sms_messages").get() as { n: number };
console.log(`[migrate] threads=${threads.n}  messages=${messages.n}`);
console.log("[migrate] done");
