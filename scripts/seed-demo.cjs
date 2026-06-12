// Build a fully-seeded DEMO database for screenshots. Copies the real DB (schema
// + your PIN so you can log in), wipes all user data, and inserts a realistic,
// generic painting-business + household dataset — so screenshots look populated
// and professional, with zero personal info.
//
//   node scripts/seed-demo.cjs <realDb> <demoDb>
//   e.g. node scripts/seed-demo.cjs "C:/Projects/Axiom/Axiom/nillad.db" "C:/Projects/Axiom/Axiom/nillad-demo.db"

const fs = require("fs");
const Database = require("better-sqlite3");

const REAL = process.argv[2] || "C:/Projects/Axiom/Axiom/nillad.db";
const DEMO = process.argv[3] || "C:/Projects/Axiom/Axiom/nillad-demo.db";

// 1) copy real -> demo (gets full schema + nf_auth PIN)
fs.copyFileSync(REAL, DEMO);
const db = new Database(DEMO);
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = OFF");

// 2) wipe user data (keep auth + migration marker)
const WIPE = [
  "activities", "tasks", "calendar_events", "chat_messages", "chats", "connections",
  "contacts", "documents", "emails", "expenses", "finance_bills", "finance_debts",
  "finance_goals", "finance_income", "finance_net_items", "finance_snapshots",
  "geo_reminders", "invoices", "job_line_items", "jobs", "memories", "pending_actions",
  "photos", "reminders", "sms_inbox", "sms_messages", "sms_threads", "subscriptions",
];
for (const t of WIPE) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch {} }

// time helpers — Denver (MDT, -06:00 in June) ISO for due/scheduled fields
const DOFF = "-06:00";
function denver(d) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}${DOFF}`;
}
const dayStr = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(d); // YYYY-MM-DD
const hrs = (n) => new Date(Date.now() + n * 3600 * 1000);
const days = (n) => new Date(Date.now() + n * 86400000);

const run = (sql, ...a) => db.prepare(sql).run(...a);
const lastId = () => db.prepare("SELECT last_insert_rowid() AS id").get().id;

// ---- Contacts ----
const contacts = [
  ["Marcus Bell", "+13035550142", "marcus.bell@example.com", "Homeowner — interior repaint"],
  ["The Hendersons", "+13035550178", "hendersons@example.com", "Exterior + trim, referral"],
  ["Jordan Cole", "+13035550119", "jordan@coleproperties.example", "GC — commercial repaints"],
  ["Dana Reyes", "+13035550155", "dana.reyes@example.com", "Deck restain"],
  ["Liam Foster", "+13035550133", "liam.foster@example.com", "Cabinet refinish estimate"],
  ["Sam Whitlock", "+13035550190", "orders@paintsupply.example", "Sherwin-Williams rep"],
];
const cId = {};
for (const [name, phone, email, notes] of contacts) {
  run(`INSERT INTO contacts (name,phone,email,notes,created_at,updated_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))`, name, phone, email, notes);
  cId[name] = lastId();
}

// ---- Activities + tasks ----
function activity(title, category, notes, tasksArr, status = "active") {
  run(`INSERT INTO activities (title,category,status,notes,created_at,updated_at) VALUES (?,?,?,?,datetime('now','-5 days'),datetime('now'))`, title, category, status, notes);
  const aid = lastId();
  tasksArr.forEach(([t, done], i) => run(`INSERT INTO tasks (activity_id,title,done,done_at,sort_order,created_at) VALUES (?,?,?,?,?,datetime('now'))`, aid, t, done ? 1 : 0, done ? "datetime('now')" && new Date().toISOString() : null, i));
  return aid;
}
activity("Launch the Sharpline website", "marketing", "Portfolio site to capture leads. Netlify + a contact form.", [["Pick a domain", 1], ["Write the services copy", 1], ["Add the project gallery", 0], ["Wire the contact form to email", 0]]);
activity("Hire a second painter", "ops", "Need help for the summer commercial work.", [["Post the listing", 1], ["Screen applicants", 0], ["Trial day with top pick", 0]]);
activity("Spring marketing push", "marketing", "Door hangers in the new Lehi neighborhoods + a Google Business profile refresh.", [["Design door hangers", 1], ["Order 500 prints", 0], ["Update Google Business photos", 0]]);

// ---- Jobs + line items + invoices ----
const today = dayStr(new Date());
function job(fields, items, invoice) {
  run(`INSERT INTO jobs (title,client,location,job_type,scope,status,contact_id,quoted_price,amount,paid,paid_at,scheduled_date,notes,created_at,updated_at)
       VALUES (@title,@client,@location,@job_type,@scope,@status,@contact_id,@quoted_price,@amount,@paid,@paid_at,@scheduled_date,@notes,datetime('now','-7 days'),datetime('now'))`, fields);
  const jid = lastId();
  let sub = 0;
  (items || []).forEach((it, i) => { run(`INSERT INTO job_line_items (job_id,description,qty,unit_price,sort_order,created_at) VALUES (?,?,?,?,?,datetime('now'))`, jid, it[0], it[1], it[2], i); sub += it[1] * it[2]; });
  if (invoice) {
    const num = invoice.number;
    run(`INSERT INTO invoices (job_id,kind,number,status,subtotal,tax_rate,tax,total,issued_on,due_on,items_json,biller,paid_at,created_at,sent_at)
         VALUES (?,?,?,?,?,0,0,?,?,?,?,?,?,datetime('now','-4 days'),?)`,
      jid, "invoice", num, invoice.status, sub, sub, invoice.issued, invoice.due,
      JSON.stringify((items || []).map((it) => ({ description: it[0], qty: it[1], unit_price: it[2] }))),
      invoice.biller, invoice.paid_at || null, invoice.sent_at || null);
  }
  return jid;
}
job({ title: "Interior Repaint — Bell Residence", client: "Marcus Bell", location: "1820 Oak Ridge Dr", job_type: "interior", scope: "Full interior repaint — main level, hallway, two bedrooms. Walls, ceilings, trim.", status: "paid", contact_id: cId["Marcus Bell"], quoted_price: 2400, amount: 2400, paid: 1, paid_at: dayStr(days(-3)), scheduled_date: dayStr(days(-6)), notes: "Loved it — referral likely." },
  [["Walls & ceilings (main level)", 1, 1450], ["Trim & doors", 1, 650], ["Two bedrooms", 1, 300]],
  { number: "INV-0007", status: "paid", issued: dayStr(days(-6)), due: dayStr(days(8)), biller: "Sharpline Painting Co.", paid_at: dayStr(days(-3)), sent_at: dayStr(days(-6)) });

job({ title: "Exterior + Trim — Henderson House", client: "The Hendersons", location: "455 Maplewood Ln", job_type: "exterior", scope: "Exterior body + trim, two-story. Power wash, scrape, prime, two coats.", status: "invoiced", contact_id: cId["The Hendersons"], quoted_price: 4800, amount: 4800, paid: 0, paid_at: null, scheduled_date: dayStr(days(-2)), notes: "Invoice sent, awaiting payment." },
  [["Power wash + prep", 1, 800], ["Body — two coats", 1, 2600], ["Trim & fascia", 1, 1400]],
  { number: "INV-0008", status: "sent", issued: dayStr(days(-2)), due: dayStr(days(12)), biller: "Sharpline Painting Co.", sent_at: dayStr(days(-2)) });

job({ title: "Office Suite Repaint — Cole Commercial", client: "Jordan Cole", location: "Cole Properties, Suite 200", job_type: "commercial", scope: "Repaint 6-office suite + common area. After-hours.", status: "scheduled", contact_id: cId["Jordan Cole"], quoted_price: 3600, amount: null, paid: 0, paid_at: null, scheduled_date: today, notes: "Starts today, after 6pm." }, [], null);

job({ title: "Deck Restain — Reyes", client: "Dana Reyes", location: "92 Birchwood Ct", job_type: "exterior", scope: "Sand + restain 400 sqft cedar deck.", status: "active", contact_id: cId["Dana Reyes"], quoted_price: 1200, amount: null, paid: 0, paid_at: null, scheduled_date: dayStr(days(1)), notes: "In progress." }, [], null);

job({ title: "Cabinet Refinish — Foster Kitchen", client: "Liam Foster", location: "12 Stonegate Way", job_type: "interior", scope: "Spray-refinish 28 cabinet doors + boxes.", status: "quoted", contact_id: cId["Liam Foster"], quoted_price: 3200, amount: null, paid: 0, paid_at: null, scheduled_date: null, notes: "Quote sent, deciding." }, [], null);

// ---- Reminders (one due-soon for the home alert) ----
const rems = [
  ["Follow up with the Hendersons on the exterior payment", denver(hrs(4)), "pending"],
  ["Order 5 gal Sherwin-Williams ProClassic for the Cole job", denver(hrs(14)), "pending"],
  ["Send Marcus the paint warranty doc", denver(days(2)), "pending"],
  ["Call Liam about the cabinet quote", denver(days(3)), "pending"],
];
for (const [text, due, status] of rems) run(`INSERT INTO reminders (text,due_at,status,created_at) VALUES (?,?,?,datetime('now'))`, text, due, status);

// ---- Calendar ----
const events = [
  ["Cole Commercial — repaint start", denver(hrs(20)), denver(hrs(23)), "Cole Properties, Suite 200"],
  ["Estimate walkthrough — Foster kitchen", denver(days(2)), denver(days(2)), "12 Stonegate Way"],
  ["Supplier pickup — paint order", denver(days(1)), null, "Sherwin-Williams, Lehi"],
];
for (const [title, start, end, loc] of events) run(`INSERT INTO calendar_events (title,start_at,end_at,all_day,location,status,created_at,updated_at) VALUES (?,?,?,0,?,'confirmed',datetime('now'),datetime('now'))`, title, start, end, loc);

// ---- Expenses (business) ----
const exp = [
  ["Sherwin-Williams", 342.18, "materials", dayStr(days(-1))],
  ["The Home Depot", 128.44, "supplies", dayStr(days(-2))],
  ["Shell", 71.9, "fuel", dayStr(days(-2))],
  ["Harbor Freight", 94.97, "tools", dayStr(days(-4))],
  ["Benjamin Moore", 210.5, "materials", dayStr(days(-5))],
];
for (const [vendor, amount, cat, on] of exp) run(`INSERT INTO expenses (vendor,amount,spent_on,category,scope,notes,created_at) VALUES (?,?,?,?,'business',NULL,datetime('now'))`, vendor, amount, on, cat);

// ---- Subscriptions ----
const subs = [
  ["Google Workspace", "Google", 7, "monthly", "email", "business", dayStr(days(12))],
  ["QuickBooks", "Intuit", 30, "monthly", "software", "business", dayStr(days(6))],
  ["sharplinepainting.co domain", "Cloudflare", 12, "yearly", "domain", "business", dayStr(days(140))],
  ["Netflix", "Netflix", 15.49, "monthly", "other", "personal", dayStr(days(9))],
  ["Spotify", "Spotify", 11.99, "monthly", "other", "personal", dayStr(days(3))],
  ["iCloud+", "Apple", 2.99, "monthly", "other", "personal", dayStr(days(18))],
];
for (const [name, vendor, amt, cad, cat, scope, renew] of subs) run(`INSERT INTO subscriptions (name,vendor,amount,cadence,category,scope,next_renewal,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))`, name, vendor, amt, cad, cat, scope, renew);

// ---- Personal finances ----
run(`INSERT INTO finance_income (person,source,amount,cadence,active,created_at) VALUES ('me','Sharpline draw',1900,'biweekly',1,datetime('now'))`);
run(`INSERT INTO finance_income (person,source,amount,cadence,active,created_at) VALUES ('wife','Nursing salary',2600,'monthly',1,datetime('now'))`);
const debts = [
  ["Chase Sapphire", "credit_card", 4200, 24.99, 95, 15],
  ["Truck loan", "auto", 14500, 6.4, 310, 5],
  ["Student loan", "student", 8200, 5.0, 120, 21],
];
for (const [n, k, bal, apr, min, due] of debts) run(`INSERT INTO finance_debts (name,kind,balance,apr,min_payment,due_day,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,datetime('now'),datetime('now'))`, n, k, bal, apr, min, due);
const bills = [
  ["Rent", 1650, "monthly", "housing"], ["Utilities", 240, "monthly", "utilities"],
  ["Groceries", 650, "monthly", "groceries"], ["Car insurance", 140, "monthly", "insurance"],
  ["Phone", 90, "monthly", "phone"],
];
for (const [n, amt, cad, cat] of bills) run(`INSERT INTO finance_bills (name,amount,cadence,category,active,created_at) VALUES (?,?,?,?,1,datetime('now'))`, n, amt, cad, cat);
run(`INSERT INTO finance_goals (name,target_amount,target_date,saved_amount,strategy,status,created_at,updated_at) VALUES ('Emergency fund',10000,?,3200,'avalanche','active',datetime('now'),datetime('now'))`, dayStr(days(110)));
run(`INSERT INTO finance_goals (name,target_amount,target_date,saved_amount,strategy,status,created_at,updated_at) VALUES ('New work truck — down payment',6000,?,1500,'avalanche','active',datetime('now'),datetime('now'))`, dayStr(days(240)));
const netItems = [
  ["personal", "asset", "Savings", 8400, "savings"], ["personal", "asset", "Checking", 2100, "checking"],
  ["personal", "asset", "Brokerage", 5500, "investment"], ["personal", "asset", "Home equity", 45000, "property"],
  ["business", "asset", "Work van", 18000, "vehicle"], ["business", "asset", "Sprayers + equipment", 6500, "equipment"],
  ["business", "liability", "Equipment loan", 7200, "loan"],
];
for (const [scope, cat, name, val, kind] of netItems) run(`INSERT INTO finance_net_items (scope,category,name,value,kind,active,created_at,updated_at) VALUES (?,?,?,?,?,1,datetime('now'),datetime('now'))`, scope, cat, name, val, kind);
// finance snapshots — trend: debt down, net worth + savings up
for (let i = 9; i >= 0; i--) {
  const d = dayStr(days(-i * 3));
  const debt = 26900 + i * 420;          // was higher, paying down
  const saved = 4700 - i * 230;          // savings rising
  const assets = 61000 - i * 360;
  const net = assets - debt;
  run(`INSERT OR REPLACE INTO finance_snapshots (taken_on,total_debt,total_saved,monthly_income,monthly_obligations,free_cashflow,total_assets,net_worth,created_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))`, d, debt, Math.max(0, saved), 6717, 4185, 2532, assets, net);
}

// ---- Messages (SMS threads) ----
function thread(phone, name, msgs) {
  run(`INSERT INTO sms_threads (contact_phone,display_name,consent_status,created_at,updated_at) VALUES (?,?,'active',datetime('now'),datetime('now'))`, phone, name);
  const tid = lastId();
  msgs.forEach((m, i) => run(`INSERT INTO sms_messages (thread_id,direction,body,twilio_status,created_at) VALUES (?,?,?,?,datetime('now','-${msgs.length - i} hours'))`, tid, m[0], m[1], m[0] === "outbound" ? "delivered" : "received"));
}
thread("+13035550142", "Marcus Bell", [["outbound", "Hey Marcus — all wrapped up, we cleaned up and the trim's fully cured. Let me know what you think!"], ["inbound", "It looks amazing, seriously. Thank you!"], ["outbound", "So glad you love it. Warranty doc is on the way. Mind if I use a photo for the portfolio?"], ["inbound", "Of course, go for it 👍"]]);
thread("+13035550119", "Jordan Cole", [["inbound", "Are we still good for the suite tonight after 6?"], ["outbound", "Yep, crew's set. We'll be in and out by 11, all after-hours."], ["inbound", "Perfect, I'll leave the key with security."]]);

// ---- Chats (for Continue + chat screenshots) ----
function chat(title, msgs, ageHrs) {
  run(`INSERT INTO chats (title,created_at,updated_at) VALUES (?,datetime('now','-${ageHrs} hours'),datetime('now','-${ageHrs} hours'))`, title);
  const ch = lastId();
  msgs.forEach((m) => run(`INSERT INTO chat_messages (chat_id,role,content,has_image,created_at) VALUES (?,?,?,0,datetime('now','-${ageHrs} hours'))`, ch, m[0], m[1]));
}
chat("This week's schedule", [["user", "What's on my plate this week?"], ["assistant", "Here's the week:\n\n- **Today** — Cole Commercial suite repaint starts after 6pm (after-hours, ~5 hrs).\n- **Tomorrow** — Supplier pickup at Sherwin-Williams (Lehi), and the Reyes deck restain continues.\n- **In 2 days** — Estimate walkthrough at the Foster kitchen, 12 Stonegate Way.\n\nTwo things need a nudge: the **Hendersons** still owe **$4,800** on INV-0008, and **Liam Foster** hasn't decided on the cabinet quote. Want me to draft a follow-up for either?"]], 2);
chat("Henderson invoice", [["user", "write up an invoice for the henderson exterior job"], ["assistant", "Here's the draft — **INV-0008**, Sharpline Painting Co.:\n\n• Power wash + prep — 1 × $800 = $800\n• Body, two coats — 1 × $2,600 = $2,600\n• Trim & fascia — 1 × $1,400 = $1,400\n\n**TOTAL: $4,800** · Due in 14 days\n\nWant me to text it to the Hendersons with a pay-by-card link?"]], 26);
chat("Debt payoff plan", [["user", "when can I realistically be debt free?"], ["assistant", "With **$2,532/mo** free cash flow and the **avalanche** method (hit the 24.99% Chase card first), you'd clear all three debts — **$26,900** total — in about **11 months**, paying roughly **$2,100** in interest along the way.\n\nIf you'd rather free up the emergency fund faster, splitting it (60% debt / 40% savings) pushes payoff to ~15 months but hits your $10k goal by **September**. Want me to make this a plan you can follow?"]], 50);

// ---- Connection + emails (Inbox) ----
run(`INSERT INTO connections (kind,provider,label,status,config,created_at,updated_at) VALUES ('email','imap','Business inbox','active',?,datetime('now'),datetime('now'))`, JSON.stringify({ host: "imap.example.com", username: "hello@sharplinepainting.co", port: "993" }));
const connId = lastId();
const emails = [
  ["leads@sharplinepainting.co", "Website Contact Form", "New lead — kitchen + living room repaint", "A homeowner in Highland wants a quote for a kitchen + living room repaint, ~600 sqft. Asked you to call this week.", 1, 0],
  ["billing@coleproperties.example", "Cole Properties", "Re: Suite 200 repaint — approved", "Jordan approved the $3,600 quote and confirmed after-hours access tonight.", 1, 0],
  ["orders@paintsupply.example", "Sherwin-Williams", "Order #SW-44821 ready for pickup", "Your 5 gal ProClassic + supplies are ready at the Lehi store.", 0, 1],
  ["news@paintpro.example", "PaintPro Weekly", "5 spray techniques for cabinet work", "This week's tips for a factory finish on cabinet doors.", 0, 1],
];
let uid = 1001;
for (const [from, fromName, subject, snippet, important, seen] of emails) {
  run(`INSERT INTO emails (connection_id,uid,from_addr,from_name,subject,date,snippet,summary,importance,important,seen,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    connId, uid++, from, fromName, subject, denver(hrs(-(uid - 1000) * 2)), snippet, snippet, important ? "high" : "normal", important, seen);
}

// ---- Documents ----
run(`INSERT INTO documents (filename,mime,kind,bytes,pages,summary,source,created_at) VALUES ('Bell — Painting Agreement.pdf','application/pdf','pdf',184320,2,'Interior repaint agreement — Bell residence. Scope, $2,400 total, 30-day workmanship warranty.','upload',datetime('now'))`);
run(`INSERT INTO documents (filename,mime,kind,bytes,pages,summary,source,created_at) VALUES ('Henderson Estimate.pdf','application/pdf','pdf',201728,1,'Exterior + trim estimate — Henderson house, two-story, $4,800.','upload',datetime('now'))`);

// ---- Pending approvals (drafts) ----
run(`INSERT INTO pending_actions (kind,status,title,detail,recipient_name,recipient_phone,draft_body,ref_type,ref_id,dedupe_key,created_at)
     VALUES ('invoice_nudge','pending','Payment reminder — Hendersons','INV-0008 ($4,800) sent 2 days ago, still unpaid.','The Hendersons','+13035550178','Hi! Just a friendly reminder that invoice INV-0008 for the exterior repaint ($4,800) is ready whenever you are — you can pay by card on the link, or Venmo works too. Thanks again! — Dallin',?,?,?,datetime('now'))`, "invoice", 0, "invoice_nudge:INV-0008");
run(`INSERT INTO pending_actions (kind,status,title,detail,recipient_name,recipient_phone,draft_body,ref_type,ref_id,dedupe_key,created_at)
     VALUES ('lead_follow_up','pending','Follow up — Foster cabinets','Quote sent 3 days ago, no reply.','Liam Foster','+13035550133','Hey Liam — no pressure at all, just checking in on the cabinet refinish quote ($3,200). Happy to answer any questions or tweak the scope. — Dallin',?,?,?,datetime('now'))`, "job", 0, "lead_follow_up:foster");

db.pragma("foreign_keys = ON");
const counts = WIPE.map((t) => { try { return `${t}=${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`; } catch { return `${t}=?`; } }).filter((s) => !s.endsWith("=0"));
console.log("[seed-demo] wrote:", DEMO);
console.log("[seed-demo] " + counts.join("  "));
db.close();
