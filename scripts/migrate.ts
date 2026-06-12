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

-- Connected sources Dallin wants Nillad to read/analyze: mailboxes, social
-- accounts, REST APIs, RSS feeds, etc. The hub (/connections) registers them;
-- per-provider ingestion is wired on top. config = non-secret JSON (host,
-- username, base_url...), secret = JSON of credential fields (kept out of config
-- so it is never sent back to the client). Local-first: secrets sit in the same
-- vault DB as everything else, same trust model as nillad.db itself.
CREATE TABLE IF NOT EXISTS connections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                       -- email | social | api | feed | other
  provider     TEXT NOT NULL,                       -- imap | gmail | outlook | x | reddit | rest | rss | custom …
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',     -- pending | active | error | disabled
  config       TEXT,                                -- JSON, non-secret fields
  secret       TEXT,                                -- JSON, credential fields (write-only to client)
  last_sync_at TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_connections_kind ON connections (kind, status);

-- Ingested email headers/snippets per IMAP connection. One row per message
-- (deduped by connection_id + uid). Bodies are NOT stored in full — just a
-- snippet + an AI summary/importance — to keep the shared DB lean. The chat
-- email tool reads from here; mutating ops (delete/archive/mark-read) go to the
-- live mailbox and update the row.
CREATE TABLE IF NOT EXISTS emails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  uid           INTEGER NOT NULL,
  message_id    TEXT,
  from_addr     TEXT,
  from_name     TEXT,
  subject       TEXT,
  date          TEXT,
  snippet       TEXT,
  summary       TEXT,
  importance    TEXT NOT NULL DEFAULT 'normal',  -- high | normal | low
  important     INTEGER NOT NULL DEFAULT 0,       -- 1 = pinged / surface it
  reason        TEXT,                              -- why it was flagged
  seen          INTEGER NOT NULL DEFAULT 0,
  pinged        INTEGER NOT NULL DEFAULT 0,        -- ntfy already sent
  archived      INTEGER NOT NULL DEFAULT 0,        -- removed/archived in mailbox
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_uid ON emails (connection_id, uid);
CREATE INDEX IF NOT EXISTS idx_emails_recent ON emails (connection_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_important ON emails (important, date DESC) WHERE archived = 0;

-- Gallery photo metadata. The image FILES live in the vault under Photos/ (so
-- they show in Obsidian too); this table only holds caption/tags keyed by
-- filename. The gallery lists files from disk and left-joins this for metadata,
-- so a photo dropped in via Obsidian still appears (just without tags yet).
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  filename   TEXT NOT NULL UNIQUE,
  caption    TEXT,
  tags       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Business expenses, typically captured by photographing a receipt (the vision
-- model extracts vendor/amount/date/category). Optionally tied to a job. The
-- receipt image is stored in the vault Photos/ dir and referenced by filename.
CREATE TABLE IF NOT EXISTS expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor     TEXT,
  amount     REAL,
  spent_on   TEXT,                       -- purchase date (YYYY-MM-DD)
  category   TEXT,                       -- materials | tools | fuel | equipment | supplies | meals | other
  job_id     INTEGER,                    -- soft link to jobs(id); no FK (jobs schema varies)
  notes      TEXT,
  photo      TEXT,                       -- receipt image filename in Photos/
  raw        TEXT,                       -- model's raw extraction JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_job ON expenses (job_id);

-- Line items for a job's estimate/invoice. qty * unit_price = line total.
CREATE TABLE IF NOT EXISTS job_line_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty         REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_line_items ON job_line_items (job_id, sort_order);

-- Generated estimates/invoices. items_json snapshots the line items at issue time
-- so a later edit to the job doesn't rewrite history. status: draft|sent|paid.
CREATE TABLE IF NOT EXISTS invoices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'invoice',   -- estimate | invoice
  number     TEXT,
  status     TEXT NOT NULL DEFAULT 'draft',      -- draft | sent | paid
  subtotal   REAL NOT NULL DEFAULT 0,
  tax_rate   REAL NOT NULL DEFAULT 0,
  tax        REAL NOT NULL DEFAULT 0,
  total      REAL NOT NULL DEFAULT 0,
  issued_on  TEXT,
  due_on     TEXT,
  notes      TEXT,
  items_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices (job_id, created_at DESC);

-- Documents Nillad can READ: uploaded PDFs/Word/text/images (and, once a mailbox
-- is connected, email attachments). text = the extracted full text the model
-- searches + reasons over; summary = a one-line gist. source: upload | email.
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  mime        TEXT,
  kind        TEXT,                         -- pdf | docx | text | image | other
  bytes       INTEGER,
  pages       INTEGER,
  text        TEXT,                         -- extracted full text (searchable)
  summary     TEXT,                         -- one-line gist
  source      TEXT NOT NULL DEFAULT 'upload', -- upload | email
  email_id    INTEGER,                      -- soft link to emails(id) when source=email
  job_id      INTEGER,                      -- optional soft link to a job
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (created_at DESC);

-- Proactive automations: drafted actions awaiting Dallin's one-tap approval. The
-- evaluator (lib/automations.ts, run by a daily cron) detects situations (an
-- invoice unpaid past N days, a lead gone quiet) and DRAFTS a message — it never
-- sends on its own. dedupe_key stops the same situation from re-drafting every run.
CREATE TABLE IF NOT EXISTS pending_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,                 -- invoice_nudge | lead_follow_up
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | sent | dismissed
  title           TEXT NOT NULL,                 -- short headline for the card
  detail          TEXT,                          -- context line (why this surfaced)
  recipient_name  TEXT,
  recipient_phone TEXT,
  draft_body      TEXT,                          -- the message text, editable before send
  ref_type        TEXT,                          -- invoice | job
  ref_id          INTEGER,
  dedupe_key      TEXT,                           -- e.g. invoice_nudge:INV-0004
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_status ON pending_actions (status, created_at DESC);

-- Location reminders: "ping me to do X when I get to <place>". An iOS Shortcut
-- "Arrive" automation hits /api/location/arrive?place=… on arrival; we match by
-- place keyword and push the reminder. One-shot by default (deactivates after
-- firing) unless repeat=1.
CREATE TABLE IF NOT EXISTS geo_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  place         TEXT NOT NULL,                 -- keyword to match the arrival place against
  text          TEXT NOT NULL,                 -- what to remind
  active        INTEGER NOT NULL DEFAULT 1,
  repeat        INTEGER NOT NULL DEFAULT 0,    -- 1 = fire every arrival, 0 = one-shot
  last_fired_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geo_reminders_active ON geo_reminders (active);

-- Recurring subscriptions / fixed costs (Google Workspace, domain, SaaS, phone,
-- insurance…). Distinct from one-off expenses: these repeat on a cadence, so the
-- tracker normalizes them to a monthly + annual burn and surfaces upcoming
-- renewals. amount = cost per cycle; cadence = how often that charge hits.
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,                  -- "Google Workspace"
  vendor       TEXT,                           -- optional payee, e.g. "Google"
  amount       REAL NOT NULL DEFAULT 0,        -- cost per cycle
  cadence      TEXT NOT NULL DEFAULT 'monthly',-- weekly | monthly | quarterly | yearly
  category     TEXT,                           -- software | email | hosting | domain | phone | insurance | equipment | marketing | banking | other
  scope        TEXT NOT NULL DEFAULT 'business',-- business | personal (which dashboard counts it)
  next_renewal TEXT,                           -- YYYY-MM-DD of the next charge
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions (active, next_renewal);

-- ===== Personal finances (separate from the business dashboard) =====
-- All manual entry; no bank connection. Income, debts, bills, and savings goals
-- feed a budget/debt-payoff engine (lib/finance.ts) that produces a game plan.

-- Income: paychecks/credits Dallin enters, his + his wife's. cadence 'once' = a
-- one-off check (logged by received_on); recurring cadences normalize to monthly.
CREATE TABLE IF NOT EXISTS finance_income (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person      TEXT,                            -- 'me' | 'wife' | a name
  source      TEXT,                            -- 'Sharpline paycheck', 'side job'…
  amount      REAL NOT NULL DEFAULT 0,
  cadence     TEXT NOT NULL DEFAULT 'biweekly',-- once | weekly | biweekly | semimonthly | monthly | yearly
  received_on TEXT,                            -- date (for 'once') or anchor date
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_income_active ON finance_income (active);

-- Debts: each card/loan with balance, APR, minimum payment, due day.
CREATE TABLE IF NOT EXISTS finance_debts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT,                            -- credit_card | auto | student | personal | medical | other
  balance     REAL NOT NULL DEFAULT 0,
  apr         REAL NOT NULL DEFAULT 0,         -- annual % rate
  min_payment REAL NOT NULL DEFAULT 0,
  due_day     INTEGER,                         -- 1..31
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_debts_active ON finance_debts (active);

-- Bills / recurring needs (rent, utilities, groceries, insurance…). Personal
-- subscriptions are tracked in the subscriptions table (scope=personal) and added on top.
CREATE TABLE IF NOT EXISTS finance_bills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  cadence    TEXT NOT NULL DEFAULT 'monthly',  -- weekly | biweekly | semimonthly | monthly | quarterly | yearly
  category   TEXT,                             -- housing | utilities | groceries | transport | insurance | phone | childcare | medical | other
  due_day    INTEGER,
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_bills_active ON finance_bills (active);

-- Savings goals ("$10k by Sept 30"). plan = last generated narrative; activity_id
-- links the goal to a follow-it task list once Dallin accepts the plan.
CREATE TABLE IF NOT EXISTS finance_goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  target_amount REAL NOT NULL DEFAULT 0,
  target_date   TEXT,
  saved_amount  REAL NOT NULL DEFAULT 0,
  strategy      TEXT,                          -- avalanche | snowball | null
  status        TEXT NOT NULL DEFAULT 'active',-- active | done | archived
  plan          TEXT,
  activity_id   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily snapshots so the charts can show debt/savings/cashflow over time.
CREATE TABLE IF NOT EXISTS finance_snapshots (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_on            TEXT NOT NULL UNIQUE,    -- YYYY-MM-DD (one row/day, upserted)
  total_debt          REAL NOT NULL DEFAULT 0,
  total_saved         REAL NOT NULL DEFAULT 0,
  monthly_income      REAL NOT NULL DEFAULT 0,
  monthly_obligations REAL NOT NULL DEFAULT 0,
  free_cashflow       REAL NOT NULL DEFAULT 0,
  total_assets        REAL NOT NULL DEFAULT 0,
  net_worth           REAL NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Net-worth line items: assets and liabilities, tagged business vs personal so
-- each dashboard computes its own net worth (assets − liabilities). Personal
-- liabilities are mostly the finance_debts; this table is for everything else
-- (accounts, property, vehicles, equipment, business loans…).
CREATE TABLE IF NOT EXISTS finance_net_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL DEFAULT 'personal', -- business | personal
  category   TEXT NOT NULL DEFAULT 'asset',     -- asset | liability
  name       TEXT NOT NULL,
  value      REAL NOT NULL DEFAULT 0,
  kind       TEXT,                              -- cash|savings|investment|property|vehicle|equipment|receivable|loan|other
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_net_items ON finance_net_items (scope, category, active);
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

// tasks.parent_id — nested sub-tasks (a checklist item can have its own steps).
// Nullable self-reference; NULL = a top-level task. No FK (ALTER can't add one in
// SQLite); deleteTask removes children explicitly.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("parent_id")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN parent_id INTEGER`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks (parent_id)`);
    console.log("[migrate] tasks: added column parent_id");
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

// Extend the pre-existing `jobs` table with the richer fields the Jobs &
// Estimates feature needs (kept additive so the existing rows survive). ALTER ADD
// COLUMN only takes constant defaults, hence plain nullable / DEFAULT 0.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name),
  );
  const ensure = (name: string, ddl: string) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${ddl}`);
      cols.add(name);
      console.log(`[migrate] jobs: added column ${name}`);
    }
  };
  ensure("title", "title TEXT");
  ensure("scope", "scope TEXT");
  ensure("contact_id", "contact_id INTEGER");
  ensure("quoted_price", "quoted_price REAL");
  ensure("paid", "paid INTEGER NOT NULL DEFAULT 0");
  ensure("paid_at", "paid_at TEXT");
  ensure("activity_id", "activity_id INTEGER");
}

// invoices.biller — which business issues this invoice (TPS vs Sharpline),
// auto-picked from the job scope at issue time but overridable.
// + Stripe pay-by-card fields: the Payment Link id (matched in the webhook to
//   auto-mark-paid) and the hosted pay URL; paid_at = when payment landed.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((c) => c.name),
  );
  const ensure = (name: string, ddl: string) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE invoices ADD COLUMN ${ddl}`);
      cols.add(name);
      console.log(`[migrate] invoices: added column ${name}`);
    }
  };
  ensure("biller", "biller TEXT");
  ensure("stripe_payment_link_id", "stripe_payment_link_id TEXT");
  ensure("stripe_url", "stripe_url TEXT");
  ensure("paid_at", "paid_at TEXT");
}

// subscriptions.scope — tag each recurring cost business vs personal so the
// business dashboard and the personal finances hub each count their own.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(subscriptions)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("scope")) {
    db.exec(`ALTER TABLE subscriptions ADD COLUMN scope TEXT NOT NULL DEFAULT 'business'`);
    console.log("[migrate] subscriptions: added column scope");
  }
}

// expenses.scope — tag each expense business vs personal (default business, since
// the existing receipt-capture flow is for the contracting/painting work).
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(expenses)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("scope")) {
    db.exec(`ALTER TABLE expenses ADD COLUMN scope TEXT NOT NULL DEFAULT 'business'`);
    console.log("[migrate] expenses: added column scope");
  }
}

// finance_snapshots — add net-worth columns to existing tables.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(finance_snapshots)").all() as { name: string }[]).map((c) => c.name),
  );
  const ensure = (name: string, ddl: string) => {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE finance_snapshots ADD COLUMN ${ddl}`);
      cols.add(name);
      console.log(`[migrate] finance_snapshots: added column ${name}`);
    }
  };
  ensure("total_assets", "total_assets REAL NOT NULL DEFAULT 0");
  ensure("net_worth", "net_worth REAL NOT NULL DEFAULT 0");
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
