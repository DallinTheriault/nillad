// Dashboard-side tool definitions + executors. Nillad's chat loop (lib/agent.ts)
// runs native function-calling against Ollama: the model returns tool calls,
// and WE execute them here — directly against nillad.db / n8n — instead of
// round-tripping through Open WebUI's slow `default` orchestration.
//
// Design: related actions are multiplexed under a single top-level tool with an
// `action` enum (e.g. reminders(action:"set"|"list"|"cancel")). gemma-12b picks
// reliably among a SMALL set of top-level tools; collapsing ~12 operations into
// 5 tools keeps selection sharp while still exposing every action.

import { getDb } from "@/lib/db";
import { sendSmsViaN8n } from "@/lib/n8n";
import { TZ, parseDue, parseStored, humanDenver, toDenverIso } from "@/lib/datetime";
import { webSearch, fetchReadable, getWeather } from "@/lib/web";
import { searchNotes, readNote, listNotes, appendNote } from "@/lib/vault";

// ---------- Tool schemas (Ollama / OpenAI function-calling format) ----------

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const TOOL_SCHEMAS: Record<string, ToolSchema> = {
  get_time: {
    type: "function",
    function: {
      name: "get_time",
      description:
        "Get the CURRENT date and time (America/Denver). Use ONLY when the user asks what the current time or date is, or you need 'now' to compute a schedule.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  reminders: {
    type: "function",
    function: {
      name: "reminders",
      description:
        "Manage timed reminders. The local dispatcher pushes a reminder when it's due. Use whenever the user wants to be reminded/alerted of something later, or to see/cancel reminders.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["set", "list", "cancel"],
            description: "set = create a reminder; list = show reminders; cancel = cancel one by id.",
          },
          text: { type: "string", description: "For action=set: what to remind about (one short sentence)." },
          due_at: {
            type: "string",
            description:
              "For action=set: when. ISO 8601 (e.g. 2026-06-09T15:30:00) or a relative phrase like 'in 5 minutes', 'in 2 hours', 'in 1 day'.",
          },
          status: {
            type: "string",
            enum: ["pending", "sent", "cancelled", "all"],
            description: "For action=list: which reminders (default 'pending').",
          },
          reminder_id: { type: "integer", description: "For action=cancel: the reminder id." },
        },
        required: ["action"],
      },
    },
  },
  activities: {
    type: "function",
    function: {
      name: "activities",
      description:
        "Dallin's activities = projects / things he's working on, each with context notes and a task checklist. Use this to recall what he's been working on (continuity), log new work, add/complete tasks, or append context notes. action='recent' answers 'what was I working on?'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "recent", "get", "add", "add_task", "complete_task", "note"],
            description:
              "list = active activities; recent = recently-touched activities + what changed (for 'what was I working on / what's unfinished'); get = one activity with its tasks; add = new activity; add_task = add a checklist item; complete_task = check one off; note = append a context note.",
          },
          activity_id: { type: "integer", description: "For get/add_task/note: the activity id." },
          task_id: { type: "integer", description: "For complete_task: the task id." },
          title: { type: "string", description: "For add: activity title. For add_task: the task text." },
          notes: { type: "string", description: "For add: initial context notes. For note: the note text to append." },
          status: {
            type: "string",
            enum: ["active", "paused", "done", "all"],
            description: "For list: which activities (default 'active').",
          },
        },
        required: ["action"],
      },
    },
  },
  jobs_contacts: {
    type: "function",
    function: {
      name: "jobs_contacts",
      description:
        "Look up Dallin's contacts (name, phone, role, notes) and painting/contracting jobs (client, location, status, amount). Use to find someone's phone number before texting, or to recall job details.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["find_contact", "list_jobs"],
            description: "find_contact = search contacts by name/phone; list_jobs = list jobs, optionally by status.",
          },
          query: { type: "string", description: "For find_contact: a name or phone fragment." },
          status: {
            type: "string",
            description: "For list_jobs: filter by status (e.g. 'lead', 'scheduled', 'done'), or omit for all.",
          },
        },
        required: ["action"],
      },
    },
  },
  calendar: {
    type: "function",
    function: {
      name: "calendar",
      description:
        "Dallin's calendar of scheduled events (meetings, jobs, appointments — distinct from reminders, which are timed pings). Use to add an event, read what's scheduled, or cancel one. Resolve relative dates ('Saturday', 'tomorrow') to explicit times before calling.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "read", "get", "cancel"],
            description:
              "add = create an event; read = list events in a date range; get = one event's full details; cancel = cancel an event by id.",
          },
          title: { type: "string", description: "For add: the event title." },
          start: {
            type: "string",
            description:
              "For add: start time. ISO 8601 (e.g. 2026-06-13T09:00:00) or relative ('in 2 hours', 'tomorrow 9am' → resolve to ISO).",
          },
          end: { type: "string", description: "For add: optional end time (ISO 8601 or relative)." },
          location: { type: "string", description: "For add: optional location." },
          description: { type: "string", description: "For add: optional notes/description." },
          time_min: { type: "string", description: "For read: range start (ISO 8601). Defaults to now." },
          time_max: { type: "string", description: "For read: range end (ISO 8601). Defaults to +7 days." },
          event_id: { type: "integer", description: "For get/cancel: the event id." },
        },
        required: ["action"],
      },
    },
  },
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for current/external/factual info Dallin asks about (news, prices, products, how things work, repos, verifying a claim). Returns titles, URLs, and snippets. Use action 'read' with a url to pull the full text of a specific result when the snippet isn't enough. Always cite the links you used.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["search", "read"], description: "search the web (default), or read one page's full text." },
          query: { type: "string", description: "For action=search: the search query. Use a focused, keyword-style query." },
          url: { type: "string", description: "For action=read: the page URL to fetch and read." },
        },
        required: [],
      },
    },
  },
  weather: {
    type: "function",
    function: {
      name: "weather",
      description:
        "Current conditions + a short forecast. Defaults to American Fork, Utah (Dallin's area) if no location is given.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Optional city/place. Omit for American Fork, Utah." },
        },
        required: [],
      },
    },
  },
  memory: {
    type: "function",
    function: {
      name: "memory",
      description:
        "Nillad's long-term memory. Save durable facts, decisions, preferences, and details about people/projects worth keeping ('remember that…'); recall them when relevant; or forget one. Save the specific fact, not the whole chat. Recall before answering questions about Dallin's history/preferences.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "recall", "forget"], description: "save a fact; recall facts (optionally matching a query); forget one by id." },
          subject: { type: "string", description: "For save: a short subject/label (e.g. 'Audi S6', 'business')." },
          note: { type: "string", description: "For save: the durable fact to remember." },
          query: { type: "string", description: "For recall: keywords to match (omit to list recent memories)." },
          memory_id: { type: "integer", description: "For forget: the memory id." },
        },
        required: ["action"],
      },
    },
  },
  vault: {
    type: "function",
    function: {
      name: "vault",
      description:
        "Dallin's Obsidian notes vault (\"Axiom\") — his real knowledge base of markdown notes (folders include Memory, Projects, Goals, Decisions, Journal, Lessons, Preferences, Inbox). SEARCH it whenever he references something he may have written down — a project, person, decision, goal, or asks 'what do I have / what did I note on X'. READ a note for its full text. APPEND to capture a durable note he wants kept, or to log to his journal. Searching is cheap — reach for it freely instead of saying you can't see his notes.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["search", "read", "list", "append"],
            description:
              "search = keyword-find notes; read = one note's full text; list = note paths (optionally in a folder); append = add text to a note (creates it if missing).",
          },
          query: { type: "string", description: "For search: keywords to find. For list: optional folder filter (e.g. 'Projects')." },
          path: { type: "string", description: "For read/append: note path relative to the vault, e.g. 'Projects/Field.md' or 'Memory/Audi S6.md'. read also accepts a partial name." },
          text: { type: "string", description: "For append: the markdown text to add to the note." },
        },
        required: ["action"],
      },
    },
  },
  send_sms: {
    type: "function",
    function: {
      name: "send_sms",
      description:
        "Send an SMS text message via Dallin's Twilio line. Use only when Dallin explicitly asks to text/message someone. Provide the recipient's phone in E.164 (e.g. +18015551234) — look it up with jobs_contacts if you only have a name. NEVER auto-reply to strangers; only send what Dallin directs.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient phone number, E.164 format (+1...)." },
          body: { type: "string", description: "The message text to send." },
        },
        required: ["to", "body"],
      },
    },
  },
};

// Default tool set for the general chat screen. Per-context callers can pass a
// narrower list (e.g. just send_sms + jobs_contacts on a Messages thread).
export const DEFAULT_TOOLS = Object.keys(TOOL_SCHEMAS);

export function toolSchemasFor(names: string[]): ToolSchema[] {
  return names.map((n) => TOOL_SCHEMAS[n]).filter(Boolean);
}

// ---------- Helpers ----------

function nowIsoLocal(): string {
  // UTC timestamp for created_at columns (matches datetime('now') elsewhere).
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
const int = (a: Args, k: string) => {
  const v = a[k];
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string" && v.trim() && !isNaN(Number(v))) return Math.trunc(Number(v));
  return NaN;
};

// ---------- Executors ----------
// Each returns a short string fed back to the model as the tool result.

function execGetTime(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `Current time: ${fmt.format(now)}`;
}

function execReminders(a: Args): string {
  const db = getDb();
  const action = str(a, "action") || "list";
  if (action === "set") {
    const text = str(a, "text");
    if (!text) return "Error: reminders(set) needs `text`.";
    let due: { iso: string; when: string };
    try {
      due = parseDue(str(a, "due_at"));
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : e}. Use ISO 8601 or 'in 5 minutes'.`;
    }
    const info = db
      .prepare(`INSERT INTO reminders (text, due_at, status, created_at) VALUES (?, ?, 'pending', ?)`)
      .run(text, due.iso, nowIsoLocal());
    return `Reminder #${info.lastInsertRowid} set for ${due.when} (${due.iso}): "${text}"`;
  }
  if (action === "cancel") {
    const id = int(a, "reminder_id");
    if (isNaN(id)) return "Error: reminders(cancel) needs `reminder_id`.";
    const r = db
      .prepare(`UPDATE reminders SET status='cancelled' WHERE id=? AND status='pending'`)
      .run(id);
    return r.changes
      ? `Reminder #${id} cancelled.`
      : `Reminder #${id} not found or not pending.`;
  }
  // list
  const status = str(a, "status") || "pending";
  const rows = (
    status === "all"
      ? db.prepare(`SELECT * FROM reminders ORDER BY due_at LIMIT 20`).all()
      : db.prepare(`SELECT * FROM reminders WHERE status=? ORDER BY due_at LIMIT 20`).all(status)
  ) as { id: number; status: string; due_at: string; text: string }[];
  if (!rows.length) return `No ${status} reminders.`;
  return rows.map((r) => `#${r.id} [${r.status}] ${r.due_at} — ${r.text}`).join("\n");
}

function execActivities(a: Args): string {
  const db = getDb();
  const action = str(a, "action") || "list";

  if (action === "add") {
    const title = str(a, "title");
    if (!title) return "Error: activities(add) needs `title`.";
    const info = db
      .prepare(
        `INSERT INTO activities (title, notes, status, created_at, updated_at)
         VALUES (?, ?, 'active', datetime('now'), datetime('now'))`,
      )
      .run(title, str(a, "notes") || null);
    return `Activity #${info.lastInsertRowid} created: "${title}"`;
  }
  if (action === "add_task") {
    const id = int(a, "activity_id");
    const title = str(a, "title");
    if (isNaN(id) || !title) return "Error: activities(add_task) needs `activity_id` and `title`.";
    const max = db
      .prepare(`SELECT COALESCE(MAX(sort_order),0) AS m FROM tasks WHERE activity_id=?`)
      .get(id) as { m: number };
    const info = db
      .prepare(
        `INSERT INTO tasks (activity_id, title, done, sort_order, created_at)
         VALUES (?, ?, 0, ?, datetime('now'))`,
      )
      .run(id, title, (max?.m ?? 0) + 1);
    db.prepare(`UPDATE activities SET updated_at=datetime('now') WHERE id=?`).run(id);
    return `Task #${info.lastInsertRowid} added to activity #${id}: "${title}"`;
  }
  if (action === "complete_task") {
    const id = int(a, "task_id");
    if (isNaN(id)) return "Error: activities(complete_task) needs `task_id`.";
    const r = db
      .prepare(`UPDATE tasks SET done=1, done_at=datetime('now') WHERE id=? AND done=0`)
      .run(id);
    return r.changes ? `Task #${id} completed.` : `Task #${id} not found or already done.`;
  }
  if (action === "note") {
    const id = int(a, "activity_id");
    const note = str(a, "notes");
    if (isNaN(id) || !note) return "Error: activities(note) needs `activity_id` and `notes`.";
    const cur = db.prepare(`SELECT notes FROM activities WHERE id=?`).get(id) as
      | { notes: string | null }
      | undefined;
    if (!cur) return `Activity #${id} not found.`;
    const merged = cur.notes ? `${cur.notes}\n${note}` : note;
    db.prepare(`UPDATE activities SET notes=?, updated_at=datetime('now') WHERE id=?`).run(merged, id);
    return `Note appended to activity #${id}.`;
  }
  if (action === "get") {
    const id = int(a, "activity_id");
    if (isNaN(id)) return "Error: activities(get) needs `activity_id`.";
    const act = db
      .prepare(`SELECT * FROM activities WHERE id=? AND archived_at IS NULL`)
      .get(id) as { id: number; title: string; status: string; notes: string | null } | undefined;
    if (!act) return `Activity #${id} not found.`;
    const tasks = db
      .prepare(`SELECT id, title, done FROM tasks WHERE activity_id=? ORDER BY sort_order`)
      .all(id) as { id: number; title: string; done: number }[];
    const taskStr = tasks.length
      ? tasks.map((t) => `  - [${t.done ? "x" : " "}] #${t.id} ${t.title}`).join("\n")
      : "  (no tasks)";
    return `#${act.id} [${act.status}] ${act.title}\nNotes: ${act.notes || "(none)"}\nTasks:\n${taskStr}`;
  }

  // list / recent
  const recent = action === "recent";
  const status = str(a, "status") || "active";
  const where =
    !recent && status !== "all" ? `AND a.status = ?` : ``;
  const params = !recent && status !== "all" ? [status] : [];
  const order = recent ? `a.updated_at DESC` : `a.updated_at DESC`;
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.status, a.notes, a.updated_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.activity_id=a.id) AS total,
              (SELECT COUNT(*) FROM tasks t WHERE t.activity_id=a.id AND t.done=1) AS done
       FROM activities a
       WHERE a.archived_at IS NULL ${where}
       ORDER BY ${order} LIMIT ${recent ? 8 : 20}`,
    )
    .all(...params) as {
    id: number;
    title: string;
    status: string;
    notes: string | null;
    updated_at: string;
    total: number;
    done: number;
  }[];
  if (!rows.length) return recent ? "No recent activities." : `No ${status} activities.`;
  return rows
    .map((r) => {
      const prog = r.total ? ` (${r.done}/${r.total} tasks)` : "";
      const note = recent && r.notes ? ` — ${r.notes.split("\n")[0].slice(0, 80)}` : "";
      return `#${r.id} [${r.status}] ${r.title}${prog}${note}${recent ? `  · updated ${r.updated_at}` : ""}`;
    })
    .join("\n");
}

function execJobsContacts(a: Args): string {
  const db = getDb();
  const action = str(a, "action") || "find_contact";
  if (action === "list_jobs") {
    const status = str(a, "status");
    const rows = (
      status
        ? db.prepare(`SELECT * FROM jobs WHERE status=? ORDER BY created_at DESC LIMIT 20`).all(status)
        : db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20`).all()
    ) as { id: number; client: string; location: string; status: string; amount: number | null }[];
    if (!rows.length) return status ? `No jobs with status '${status}'.` : "No jobs logged.";
    return rows
      .map(
        (r) =>
          `#${r.id} [${r.status}] ${r.client || "(no client)"} — ${r.location || "(no location)"}${
            r.amount != null ? ` · $${r.amount}` : ""
          }`,
      )
      .join("\n");
  }
  // find_contact
  const q = str(a, "query");
  if (!q) return "Error: jobs_contacts(find_contact) needs `query`.";
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT id, name, phone, role, notes FROM contacts
       WHERE archived_at IS NULL AND (name LIKE ? OR phone LIKE ?)
       ORDER BY name LIMIT 10`,
    )
    .all(like, like) as {
    id: number;
    name: string | null;
    phone: string | null;
    role: string | null;
    notes: string | null;
  }[];
  if (!rows.length) return `No contact matching "${q}".`;
  return rows
    .map(
      (r) =>
        `#${r.id} ${r.name || "(no name)"}${r.phone ? ` · ${r.phone}` : ""}${
          r.role ? ` · ${r.role}` : ""
        }`,
    )
    .join("\n");
}

// Record a chat-sent outbound text into the threads tables so it shows in the
// Messages UI — same path the manual ReplyBox uses (find/create the thread, insert
// the message; the sms_messages_update_thread trigger bumps last_*). created_at is
// datetime('now') (UTC), matching sendReply and how the page reads timestamps.
function recordOutbound(to: string, body: string, sid: string | null, status: string | null): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO sms_threads (contact_phone, created_at, updated_at)
     VALUES (?, datetime('now'), datetime('now'))`,
  ).run(to);
  const thread = db
    .prepare(`SELECT id FROM sms_threads WHERE contact_phone = ?`)
    .get(to) as { id: number } | undefined;
  if (!thread) return;
  db.prepare(
    `INSERT INTO sms_messages (thread_id, direction, body, twilio_message_sid, twilio_status, created_at)
     VALUES (?, 'outbound', ?, ?, ?, datetime('now'))`,
  ).run(thread.id, body, sid ?? null, status ?? "queued");
}

async function execSendSms(a: Args): Promise<string> {
  const to = str(a, "to");
  const body = str(a, "body");
  if (!to || !body) return "Error: send_sms needs `to` (E.164) and `body`.";
  if (!/^\+\d{7,15}$/.test(to))
    return `Error: "${to}" is not a valid E.164 number (expected +1...). Look it up with jobs_contacts first.`;
  const res = await sendSmsViaN8n(to, body);
  if (!res.ok) return `Failed to send SMS: ${res.error}`;
  // The text is sent; recording is best-effort so a DB hiccup never reports failure.
  try {
    recordOutbound(to, body, res.message_sid ?? null, res.status ?? null);
  } catch {
    /* sent but not recorded — still report success */
  }
  return `SMS sent to ${to}${res.status ? ` (${res.status})` : ""}.`;
}

function execCalendar(a: Args): string {
  const db = getDb();
  const action = str(a, "action") || "read";

  if (action === "add") {
    const title = str(a, "title");
    if (!title) return "Error: calendar(add) needs `title`.";
    let start: { iso: string; when: string };
    try {
      start = parseDue(str(a, "start"));
    } catch (e) {
      return `Error: bad start — ${e instanceof Error ? e.message : e}. Use ISO 8601.`;
    }
    let endIso: string | null = null;
    let endWhen = "";
    const endRaw = str(a, "end");
    if (endRaw) {
      try {
        const end = parseDue(endRaw);
        endIso = end.iso;
        endWhen = ` – ${end.when}`;
      } catch {
        /* ignore a bad end; keep the event start-only */
      }
    }
    const info = db
      .prepare(
        `INSERT INTO calendar_events (title, start_at, end_at, location, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(title, start.iso, endIso, str(a, "location") || null, str(a, "description") || null);
    return `Event #${info.lastInsertRowid} added: "${title}" — ${start.when}${endWhen}.`;
  }

  if (action === "cancel") {
    const id = int(a, "event_id");
    if (isNaN(id)) return "Error: calendar(cancel) needs `event_id`.";
    const r = db
      .prepare(`UPDATE calendar_events SET status='cancelled', updated_at=datetime('now') WHERE id=? AND status='confirmed'`)
      .run(id);
    return r.changes ? `Event #${id} cancelled.` : `Event #${id} not found or already cancelled.`;
  }

  if (action === "get") {
    const id = int(a, "event_id");
    if (isNaN(id)) return "Error: calendar(get) needs `event_id`.";
    const e = db.prepare(`SELECT * FROM calendar_events WHERE id=?`).get(id) as
      | { id: number; title: string; start_at: string; end_at: string | null; location: string | null; description: string | null; status: string }
      | undefined;
    if (!e) return `Event #${id} not found.`;
    return [
      `#${e.id} [${e.status}] ${e.title}`,
      `Start: ${humanDenver(parseStored(e.start_at))}`,
      e.end_at ? `End: ${humanDenver(parseStored(e.end_at))}` : null,
      e.location ? `Where: ${e.location}` : null,
      e.description ? `Notes: ${e.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // read
  const min = str(a, "time_min");
  const max = str(a, "time_max");
  const minIso = min ? safeIso(min) : toDenverIso(new Date());
  const maxIso = max ? safeIso(max) : toDenverIso(new Date(Date.now() + 7 * 86400 * 1000));
  const rows = db
    .prepare(
      `SELECT id, title, start_at, end_at, location FROM calendar_events
       WHERE status='confirmed' AND datetime(start_at) >= datetime(?) AND datetime(start_at) <= datetime(?)
       ORDER BY start_at LIMIT 50`,
    )
    .all(minIso, maxIso) as {
    id: number;
    title: string;
    start_at: string;
    end_at: string | null;
    location: string | null;
  }[];
  if (!rows.length) return "No events in that range.";
  return rows
    .map(
      (e) =>
        `#${e.id} ${humanDenver(parseStored(e.start_at))} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`,
    )
    .join("\n");
}

// Normalize a model-supplied ISO/relative time to a stored Denver-offset ISO; on
// failure fall back to the raw string so the SQL comparison still runs.
function safeIso(s: string): string {
  try {
    return parseDue(s).iso;
  } catch {
    return s;
  }
}

async function execWebSearch(a: Args): Promise<string> {
  const action = str(a, "action") || "search";
  if (action === "read") {
    const url = str(a, "url");
    if (!url) return "Error: web_search(read) needs `url`.";
    try {
      const text = await fetchReadable(url);
      return text ? `Content of ${url}:\n${text}` : `No readable text at ${url}.`;
    } catch (e) {
      return `Couldn't read ${url}: ${e instanceof Error ? e.message : e}`;
    }
  }
  const query = str(a, "query");
  if (!query) return "Error: web_search needs a `query`.";
  try {
    const hits = await webSearch(query, 5);
    if (!hits.length) return `No results for "${query}".`;
    return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join("\n");
  } catch (e) {
    return `Search failed: ${e instanceof Error ? e.message : e}`;
  }
}

async function execWeather(a: Args): Promise<string> {
  try {
    return await getWeather(str(a, "location") || undefined);
  } catch (e) {
    return `Weather lookup failed: ${e instanceof Error ? e.message : e}`;
  }
}

function execMemory(a: Args): string {
  const db = getDb();
  const action = str(a, "action") || "recall";
  if (action === "save") {
    const subject = str(a, "subject");
    const note = str(a, "note");
    if (!note) return "Error: memory(save) needs `note`.";
    const info = db
      .prepare(`INSERT INTO memories (subject, note, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`)
      .run(subject || "(general)", note);
    return `Saved memory #${info.lastInsertRowid}: ${subject ? subject + " — " : ""}${note}`;
  }
  if (action === "forget") {
    const id = int(a, "memory_id");
    if (isNaN(id)) return "Error: memory(forget) needs `memory_id`.";
    const r = db.prepare(`DELETE FROM memories WHERE id=?`).run(id);
    return r.changes ? `Forgot memory #${id}.` : `Memory #${id} not found.`;
  }
  // recall — match on ANY meaningful word in the query (not the whole phrase as a
  // substring), so "Audi oil change" finds "Audi S6 needs an oil change…".
  const q = str(a, "query");
  let rows: { id: number; subject: string; note: string }[];
  const words = q.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (words.length) {
    const clause = words.map(() => `(subject LIKE ? OR note LIKE ?)`).join(" OR ");
    const params = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
    rows = db
      .prepare(`SELECT id, subject, note FROM memories WHERE ${clause} ORDER BY created_at DESC LIMIT 15`)
      .all(...params) as typeof rows;
  } else {
    rows = db.prepare(`SELECT id, subject, note FROM memories ORDER BY created_at DESC LIMIT 15`).all() as typeof rows;
  }
  if (!rows.length) return q ? `No memories matching "${q}". (Saved memories may use different words.)` : "No memories saved yet.";
  return rows.map((r) => `#${r.id} [${r.subject}] ${r.note}`).join("\n");
}

function execVault(a: Args): string {
  const action = str(a, "action") || "search";
  if (action === "search") return searchNotes(str(a, "query"));
  if (action === "read") return readNote(str(a, "path") || str(a, "query"));
  if (action === "list") return listNotes(str(a, "query") || undefined);
  if (action === "append") return appendNote(str(a, "path"), str(a, "text"));
  return `Error: unknown vault action "${action}". Use search/read/list/append.`;
}

// Dispatch a single tool call by name. Returns the string result for the model.
export async function executeTool(name: string, args: Args): Promise<string> {
  try {
    switch (name) {
      case "get_time":
        return execGetTime();
      case "reminders":
        return execReminders(args);
      case "activities":
        return execActivities(args);
      case "jobs_contacts":
        return execJobsContacts(args);
      case "calendar":
        return execCalendar(args);
      case "web_search":
        return await execWebSearch(args);
      case "weather":
        return await execWeather(args);
      case "memory":
        return execMemory(args);
      case "vault":
        return execVault(args);
      case "send_sms":
        return await execSendSms(args);
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (e) {
    return `Error executing ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
