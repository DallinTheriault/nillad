// Set or reset the dashboard PIN. Run with:
//   $env:NF_PIN = '1234'; npm run set-pin
// Or pass as argv:
//   npx tsx scripts/set-pin.ts 1234

import Database from "better-sqlite3";
import bcrypt from "bcrypt";

const DB_PATH = process.env.NILLAD_DB || "./nillad.db";
const pin = process.env.NF_PIN || process.argv[2];

if (!pin) {
  console.error("Usage: NF_PIN=<pin> npm run set-pin   OR   npx tsx scripts/set-pin.ts <pin>");
  process.exit(1);
}
if (pin.length < 4) {
  console.error("PIN must be at least 4 characters.");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS nf_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
const hash = bcrypt.hashSync(pin, 10);
db.prepare(
  `INSERT INTO nf_auth (id, pin_hash, updated_at) VALUES (1, ?, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`,
).run(hash);
console.log("[set-pin] PIN set.");
