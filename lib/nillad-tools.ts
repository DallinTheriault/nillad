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
import { deepResearch } from "@/lib/research";
import { listDocuments, getDocument } from "@/lib/documents";
import { createGeoReminder } from "@/lib/geo";
import { getDashboard } from "@/lib/dashboard";
import {
  listSubscriptions,
  subscriptionSummary,
  upcomingRenewals,
  monthlyEquivalent,
  CADENCES,
} from "@/lib/subscriptions";
import {
  getFinanceSummary,
  simulatePayoff,
  listDebts as listFinDebts,
  listGoals as listFinGoals,
  goalFeasibility,
  getNetWorth,
} from "@/lib/finance";
import {
  syncAllMailboxes,
  markEmailSeen,
  archiveEmail,
  deleteEmail,
  moveEmail,
} from "@/lib/email";
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  setPaid,
  addLineItem,
  createJobFromActivity,
  buildInvoice,
  getInvoice,
  formatInvoiceText,
  sendInvoice,
  money,
} from "@/lib/jobs";

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
        "Manage reminders. TIMED reminders fire at a due time (the local dispatcher pushes them). LOCATION reminders fire when Dallin arrives somewhere (e.g. 'remind me to check the trim when I get to the Lehi site') — set these by passing `place` instead of `due_at`. Use whenever he wants to be reminded/alerted, or to see/cancel reminders.",
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
              "For a TIMED reminder: when. ISO 8601 (e.g. 2026-06-09T15:30:00) or a relative phrase like 'in 5 minutes', 'in 2 hours', 'in 1 day'.",
          },
          place: {
            type: "string",
            description:
              "For a LOCATION reminder: the place to fire on arrival (e.g. 'Lehi site', 'Home Depot'). Provide this INSTEAD of due_at when he says 'when I get to / arrive at / am at <place>'.",
          },
          repeat: {
            type: "string",
            description: "For a location reminder: 'true' to fire on every arrival, else it's one-time (default).",
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
            enum: ["list", "recent", "get", "add", "add_task", "complete_task", "complete", "reopen", "note"],
            description:
              "list = active activities; recent = recently-touched activities + what changed; get = one activity with its tasks; add = new activity; add_task = add a checklist item; complete_task = check ONE task off; complete = FINISH/close the whole activity (sets it done) — use this when he says 'finish/close/mark done/complete the X activity'; reopen = set a done activity back to active; note = append a context note.",
          },
          activity_id: { type: "integer", description: "For get/add_task/note/complete/reopen: the activity id." },
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
        "Dallin's contacts (name, phone, notes) and painting/contracting jobs. Look up a contact's phone before texting, recall job details, or ADD a new contact ('save Mike's number 801-555-0112', 'add Sarah Chen, sarah@example.com'). Dallin can't add contacts by hand from chat, so use add_contact whenever he gives you someone to save.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["find_contact", "list_jobs", "add_contact"],
            description: "find_contact = search by name/phone; list_jobs = list jobs by status; add_contact = save a new contact (needs name; phone/email/notes optional).",
          },
          query: { type: "string", description: "For find_contact: a name or phone fragment." },
          name: { type: "string", description: "For add_contact: the person's name." },
          phone: { type: "string", description: "For add_contact: phone number (any format)." },
          email: { type: "string", description: "For add_contact: email (optional)." },
          notes: { type: "string", description: "For add_contact: who they are / context (optional)." },
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
  deep_research: {
    type: "function",
    function: {
      name: "deep_research",
      description:
        "Multi-source web research with synthesis. Use this INSTEAD of web_search whenever the question needs more than one quick fact — anything that benefits from comparing/combining several sources: 'research X', 'compare A vs B', 'what's the best/cheapest …', 'pros and cons', 'is X worth it', a buying decision, or an in-depth/current topic. It plans several searches, reads the top pages, and returns cited findings for you to synthesize. Prefer the lighter web_search only for a single quick lookup or to read one known page.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The research question, in natural language (e.g. 'best mid-size SUV for towing under $40k 2026').",
          },
        },
        required: ["query"],
      },
    },
  },
  email: {
    type: "function",
    function: {
      name: "email",
      description:
        "Read, triage, and manage Dallin's connected email (IMAP mailboxes he added on the Connections page). Use whenever he asks about his email/inbox — 'any important emails?', 'what's new in my inbox', 'check my email', 'find the email from X', 'read that warranty email', or to act on one (mark read / archive / delete / move). Reading is instant from stored mail; 'sync' fetches the latest from the server first.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["recent", "important", "search", "get", "sync", "mark_read", "archive", "delete", "move"],
            description:
              "recent = latest messages; important = only the flagged/important ones; search = find by sender/subject/keyword; get = one message's details + snippet; sync = pull newest mail from the server now; mark_read/archive/delete/move = act on one message by id. delete & move are destructive — confirm with Dallin first.",
          },
          query: { type: "string", description: "For search: sender name/address, subject, or keyword." },
          email_id: { type: "integer", description: "For get/mark_read/archive/delete/move: the message id from a list." },
          folder: { type: "string", description: "For move: the destination IMAP folder name (e.g. 'Receipts')." },
          limit: { type: "integer", description: "For recent/important/search: how many to return (default 10)." },
        },
        required: ["action"],
      },
    },
  },
  documents: {
    type: "function",
    function: {
      name: "documents",
      description:
        "Read the documents Dallin has uploaded — contracts, bids, spec sheets, bills, PDFs, Word docs, scanned/photographed paperwork. Use whenever he asks about a document or its contents: 'what are the payment terms in that contract?', 'summarize the bid I uploaded', 'what's the deadline in the spec sheet', 'how much was that bill?'. list = see what's on file; search = find the relevant doc by name/keyword; get = pull a document's full extracted text so you can answer from it. Always get the actual text before answering questions about a document.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "search", "get"],
            description:
              "list = recent documents; search = find documents by filename/keyword; get = one document's full extracted text (read this before answering questions about it).",
          },
          query: { type: "string", description: "For search: a filename fragment or keyword to find the right document." },
          document_id: { type: "integer", description: "For get: the document id (from list/search)." },
          limit: { type: "integer", description: "For list/search: how many to return (default 15)." },
        },
        required: ["action"],
      },
    },
  },
  jobs: {
    type: "function",
    function: {
      name: "jobs",
      description:
        "Dallin's contracting/painting JOBS — richer than jobs_contacts (which is read-only lookup). Manage a job's details, line items, status, and payment. 'from_activity' spins up a job pre-filled from one of his activities (name/address/scope). Use this when he talks about a specific job/project he's quoting, doing, or finishing. To BILL a job (estimate/invoice), use the separate `invoice` tool.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "get", "create", "from_activity", "update", "set_status", "mark_paid", "add_item"],
            description:
              "list = all jobs; get = one job's full detail (by job_id); create = new job; from_activity = create a job seeded from an activity (needs activity_id); update = edit fields; set_status = change status; mark_paid = mark paid/unpaid; add_item = add a line item (description, qty, unit_price).",
          },
          job_id: { type: "integer", description: "For get/update/set_status/mark_paid/add_item." },
          activity_id: { type: "integer", description: "For from_activity: the source activity id." },
          title: { type: "string", description: "Job name." },
          client: { type: "string", description: "Client/primary contact name." },
          location: { type: "string", description: "Job site address." },
          scope: { type: "string", description: "Scope of work." },
          status: { type: "string", enum: ["lead", "quoted", "scheduled", "active", "done", "invoiced", "paid"], description: "For set_status/create." },
          quoted_price: { type: "number", description: "Quoted price for the job." },
          contact_id: { type: "integer", description: "Primary contact id (from jobs_contacts/find_contact)." },
          description: { type: "string", description: "For add_item: line item description." },
          qty: { type: "number", description: "For add_item: quantity (default 1)." },
          unit_price: { type: "number", description: "For add_item: price per unit." },
          paid: { type: "boolean", description: "For mark_paid: true = paid, false = unpaid." },
        },
        required: ["action"],
      },
    },
  },
  invoice: {
    type: "function",
    function: {
      name: "invoice",
      description:
        "Create, preview, and send an ESTIMATE or INVOICE for a job. Typical flow: when Dallin finishes a job and says 'write up an invoice for the X job', call create → it returns the drafted invoice text to show him → after he okays it, call send to text it to the job's primary contact. ALWAYS show him the draft and get his ok before send (don't auto-send).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "get", "send"], description: "create a draft from a job; get an existing one; send it (SMS to the job's contact)." },
          job_id: { type: "integer", description: "For create: which job to bill." },
          invoice_id: { type: "integer", description: "For get/send: the invoice id." },
          kind: { type: "string", enum: ["estimate", "invoice"], description: "For create: estimate (before) or invoice (after the work). Default invoice." },
          biller: { type: "string", enum: ["tps", "sharpline"], description: "Which business bills. Omit to auto-pick (Sharpline if it's painting-only, else TPS)." },
        },
        required: ["action"],
      },
    },
  },
  finances: {
    type: "function",
    function: {
      name: "finances",
      description:
        "Dallin's business numbers at a glance — revenue this month + all-time, money owed (unpaid invoices, with aging by how overdue), spend this month + top categories, net, and the jobs pipeline. Use whenever he asks how business/money is doing: 'how's business this month', 'how much am I owed', 'what's my revenue', 'who owes me', 'how much have I spent', 'what's in the pipeline'. Read this before answering money/business-health questions instead of guessing.",
      parameters: { type: "object", properties: {} },
    },
  },
  subscriptions: {
    type: "function",
    function: {
      name: "subscriptions",
      description:
        "Dallin's recurring costs / subscriptions (Google Workspace, domain renewal, SaaS, phone, insurance…) — separate from one-off expenses. Use to report his subscription burn ('what am I paying monthly', 'how much on subscriptions', 'what's my recurring spend'), list them, see what renews soon, or ADD one he mentions ('add Google Workspace, 7 a month', 'I'm paying $20/yr for the domain'). amount is the cost PER cycle; cadence is how often it bills.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["summary", "list", "upcoming", "add"],
            description: "summary = total monthly+annual burn; list = all subscriptions; upcoming = renewing within 30 days; add = log a new one.",
          },
          name: { type: "string", description: "For add: the subscription name (e.g. 'Google Workspace')." },
          amount: { type: "number", description: "For add: cost per cycle (a number, no $)." },
          cadence: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"], description: "For add: how often it bills. Default monthly." },
          category: { type: "string", description: "For add: optional category (software, email, domain, phone, insurance, etc.)." },
          next_renewal: { type: "string", description: "For add: optional next charge date, YYYY-MM-DD." },
        },
        required: ["action"],
      },
    },
  },
  personal_finance: {
    type: "function",
    function: {
      name: "personal_finance",
      description:
        "Dallin's PERSONAL / household finances — SEPARATE from the business 'finances' tool. Covers his and his wife's income, debts, bills, savings goals, budget, and debt payoff. Use to report his money picture ('how's my budget', 'what's my free cash flow', 'how much debt do I have', 'when can I be debt-free', 'am I on track for my goal'), OR to LOG things he tells you: 'add a debt — Chase card $4,000 at 24% APR, $90 minimum', 'I make $1,800 biweekly', 'add rent $1,500 a month', 'goal: save $10k by Sept 30'. NOTE: 'finances' = the BUSINESS dashboard; this tool = personal/household money.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["summary", "debts", "goals", "add_income", "add_debt", "add_bill", "add_goal"],
            description: "summary = budget overview + payoff estimate; debts = list + payoff order; goals = goals + feasibility; add_* = log a new item.",
          },
          name: { type: "string", description: "Name/label (debt name, bill name, income source, or goal name)." },
          amount: { type: "number", description: "Dollar amount: balance for a debt, per-cycle amount for income/bill, or target for a goal." },
          apr: { type: "number", description: "For add_debt: annual interest rate %." },
          min_payment: { type: "number", description: "For add_debt: minimum monthly payment." },
          cadence: { type: "string", description: "For add_income/add_bill: once|weekly|biweekly|semimonthly|monthly|quarterly|yearly." },
          person: { type: "string", description: "For add_income: who (me/wife/name)." },
          category: { type: "string", description: "For add_bill: housing|utilities|groceries|transport|insurance|phone|etc." },
          target_date: { type: "string", description: "For add_goal: target date YYYY-MM-DD." },
        },
        required: ["action"],
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
    // Location reminder: if a place is given, it fires on arrival (via the iOS
    // Arrive shortcut), not at a time.
    const place = str(a, "place");
    if (place) {
      const id = createGeoReminder(place, text, /^(1|true|yes)$/i.test(str(a, "repeat")));
      return `Location reminder #${id} set: "${text}" when you arrive at ${place}. (Needs the iOS Arrive shortcut for ${place}.)`;
    }
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
  if (action === "complete" || action === "reopen") {
    let id = int(a, "activity_id");
    if (isNaN(id)) {
      // Forgiving: let Nillad finish an activity by name, not just id.
      const title = str(a, "title");
      if (title) {
        const m = db
          .prepare(`SELECT id FROM activities WHERE archived_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT 1`)
          .get(`%${title}%`) as { id: number } | undefined;
        if (m) id = m.id;
      }
    }
    if (isNaN(id)) return `Error: activities(${action}) needs an \`activity_id\` (or a \`title\` to match).`;
    const act = db.prepare(`SELECT title FROM activities WHERE id=? AND archived_at IS NULL`).get(id) as { title: string } | undefined;
    if (!act) return `Activity #${id} not found.`;
    if (action === "reopen") {
      db.prepare(`UPDATE activities SET status='active', updated_at=datetime('now') WHERE id=?`).run(id);
      return `Activity #${id} "${act.title}" reopened (active again).`;
    }
    db.prepare(`UPDATE activities SET status='done', updated_at=datetime('now') WHERE id=?`).run(id);
    db.prepare(`UPDATE tasks SET done=1, done_at=datetime('now') WHERE activity_id=? AND done=0`).run(id);
    return `Activity #${id} "${act.title}" finished — marked done and any open tasks checked off.`;
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
  if (action === "add_contact") {
    const name = str(a, "name");
    if (!name) return "Error: jobs_contacts(add_contact) needs at least a `name`.";
    const phone = str(a, "phone");
    const d = phone.replace(/\D/g, "");
    const e164 = !d ? null : phone.trim().startsWith("+") ? `+${d}` : d.length === 10 ? `+1${d}` : `+${d}`;
    // Dedup by name or phone so the same person isn't added twice.
    const dup = db
      .prepare(`SELECT id, name FROM contacts WHERE archived_at IS NULL AND (lower(name)=lower(?) OR (?<>'' AND replace(replace(replace(phone,' ',''),'-',''),'+','') LIKE ?))`)
      .get(name, e164 || "", e164 ? `%${e164.replace(/\D/g, "").slice(-10)}%` : "___nomatch___") as { id: number; name: string } | undefined;
    if (dup) return `${dup.name} is already a contact (#${dup.id}).`;
    const info = db
      .prepare(`INSERT INTO contacts (name, phone, email, notes, created_at, updated_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))`)
      .run(name, e164 || phone || null, str(a, "email") || null, str(a, "notes") || null);
    return `Added contact #${info.lastInsertRowid}: ${name}${e164 ? ` · ${e164}` : ""}.`;
  }
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
  // find_contact — word-based fuzzy match. Fetch the (small) contact list and
  // rank by how many query words appear in the name, so a typo'd/misheard first
  // name still finds the person by their correct last name ("Tander Brumfield"
  // → Tanner Brumfield via "brumfield"). Phone fragments score too.
  const q = str(a, "query");
  if (!q) return "Error: jobs_contacts(find_contact) needs `query`.";
  const words = q.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const digits = q.replace(/\D/g, "");
  type C = { id: number; name: string | null; phone: string | null; role: string | null; notes: string | null };
  const all = db
    .prepare(`SELECT id, name, phone, role, notes FROM contacts WHERE archived_at IS NULL`)
    .all() as C[];
  const scored: { c: C; score: number }[] = [];
  for (const c of all) {
    const name = (c.name || "").toLowerCase();
    let score = 0;
    for (const w of words) if (name.includes(w)) score += 1;
    if (digits.length >= 4 && (c.phone || "").replace(/\D/g, "").includes(digits)) score += 2;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const rows = scored.slice(0, 10).map((s) => s.c);
  if (!rows.length) return `No contact matching "${q}".`;
  return rows
    .map((r) => `#${r.id} ${r.name || "(no name)"}${r.phone ? ` · ${r.phone}` : ""}${r.role ? ` · ${r.role}` : ""}`)
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

async function execDeepResearch(a: Args, onStatus?: (label: string) => void): Promise<string> {
  const query = str(a, "query");
  if (!query) return "Error: deep_research needs a `query`.";
  try {
    return await deepResearch(query, onStatus);
  } catch (e) {
    return `Deep research failed: ${e instanceof Error ? e.message : e}`;
  }
}

async function execEmail(a: Args, onStatus?: (label: string) => void): Promise<string> {
  const db = getDb();
  const action = str(a, "action") || "recent";
  const limit = Math.min(Math.max(int(a, "limit") || 10, 1), 25);

  const fmtRow = (r: {
    id: number;
    from_name: string | null;
    from_addr: string | null;
    subject: string | null;
    date: string | null;
    summary: string | null;
    importance: string;
    seen: number;
  }) => {
    const who = r.from_name || r.from_addr || "(unknown)";
    const when = r.date ? r.date.slice(0, 16).replace("T", " ") : "";
    const flag = r.importance === "high" ? "❗" : r.importance === "low" ? "·" : "";
    const unread = r.seen ? "" : " [unread]";
    return `#${r.id} ${flag}${who} — ${r.subject || "(no subject)"}${unread}\n   ${r.summary || ""}${when ? `  · ${when}` : ""}`;
  };
  const cols = `id, from_name, from_addr, subject, date, summary, importance, seen`;

  if (action === "sync") {
    onStatus?.("Checking your email…");
    const results = await syncAllMailboxes();
    if (!results.length) return "No active mailboxes connected. Add one on the Connections page (IMAP).";
    const added = results.reduce((n, r) => n + r.added, 0);
    const flagged = results.reduce((n, r) => n + r.flagged, 0);
    const errs = results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`);
    return [
      `Synced ${results.length} mailbox(es): ${added} new message(s), ${flagged} flagged important.`,
      errs.length ? `Errors — ${errs.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (action === "important") {
    const rows = db
      .prepare(
        `SELECT ${cols} FROM emails WHERE important=1 AND archived=0 ORDER BY date DESC LIMIT ?`,
      )
      .all(limit) as Parameters<typeof fmtRow>[0][];
    if (!rows.length) return "No important emails right now.";
    return `Important email:\n${rows.map(fmtRow).join("\n")}`;
  }

  if (action === "search") {
    const q = str(a, "query");
    if (!q) return "Error: email(search) needs a `query`.";
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT ${cols} FROM emails
         WHERE archived=0 AND (from_name LIKE ? OR from_addr LIKE ? OR subject LIKE ? OR summary LIKE ? OR snippet LIKE ?)
         ORDER BY date DESC LIMIT ?`,
      )
      .all(like, like, like, like, like, limit) as Parameters<typeof fmtRow>[0][];
    if (!rows.length) return `No email matching "${q}".`;
    return `Matches for "${q}":\n${rows.map(fmtRow).join("\n")}`;
  }

  if (action === "get") {
    const id = int(a, "email_id");
    if (isNaN(id)) return "Error: email(get) needs `email_id`.";
    const r = db
      .prepare(
        `SELECT id, from_name, from_addr, subject, date, summary, snippet, importance, reason, seen
         FROM emails WHERE id=?`,
      )
      .get(id) as
      | {
          id: number;
          from_name: string | null;
          from_addr: string | null;
          subject: string | null;
          date: string | null;
          summary: string | null;
          snippet: string | null;
          importance: string;
          reason: string | null;
          seen: number;
        }
      | undefined;
    if (!r) return `Email #${id} not found.`;
    return [
      `From: ${r.from_name ? `${r.from_name} <${r.from_addr}>` : r.from_addr || "(unknown)"}`,
      `Subject: ${r.subject || "(no subject)"}`,
      r.date ? `Date: ${r.date.slice(0, 16).replace("T", " ")}` : "",
      `Importance: ${r.importance}${r.reason ? ` (${r.reason})` : ""}${r.seen ? "" : " · unread"}`,
      `Summary: ${r.summary || "—"}`,
      "",
      r.snippet || "(no preview text)",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Mutating actions by id.
  const id = int(a, "email_id");
  if (action === "mark_read") {
    if (isNaN(id)) return "Error: email(mark_read) needs `email_id`.";
    return await markEmailSeen(id);
  }
  if (action === "archive") {
    if (isNaN(id)) return "Error: email(archive) needs `email_id`.";
    return await archiveEmail(id);
  }
  if (action === "delete") {
    if (isNaN(id)) return "Error: email(delete) needs `email_id`.";
    return await deleteEmail(id);
  }
  if (action === "move") {
    const folder = str(a, "folder");
    if (isNaN(id) || !folder) return "Error: email(move) needs `email_id` and `folder`.";
    return await moveEmail(id, folder);
  }

  // recent (default)
  const rows = db
    .prepare(`SELECT ${cols} FROM emails WHERE archived=0 ORDER BY date DESC LIMIT ?`)
    .all(limit) as Parameters<typeof fmtRow>[0][];
  if (!rows.length)
    return "No email ingested yet. If you just connected a mailbox, run a sync (action='sync') to pull it.";
  return `Recent email:\n${rows.map(fmtRow).join("\n")}`;
}

async function execJobs(a: Args): Promise<string> {
  const action = str(a, "action") || "list";

  if (action === "list") {
    const rows = listJobs();
    if (!rows.length) return "No jobs yet.";
    return rows
      .map((j) => {
        const price = j.quoted_price ?? j.items_total ?? null;
        return `#${j.id} ${j.title || j.client || "(untitled)"} [${j.status || "lead"}]${j.contact_name ? ` · ${j.contact_name}` : ""}${price ? ` · ${money(price)}` : ""}${j.paid ? " · PAID" : ""}`;
      })
      .join("\n");
  }
  if (action === "from_activity") {
    const aid = int(a, "activity_id");
    if (isNaN(aid)) return "Error: jobs(from_activity) needs `activity_id`.";
    const r = await createJobFromActivity(aid);
    if ("error" in r) return r.error;
    const got = getJob(r.id);
    return `Created job #${r.id} from activity #${aid}.\n${got ? jobDetail(got) : ""}`;
  }
  if (action === "create") {
    const id = createJob({
      title: str(a, "title") || null,
      client: str(a, "client") || null,
      location: str(a, "location") || null,
      scope: str(a, "scope") || null,
      status: str(a, "status") || "lead",
      quoted_price: isNaN(int(a, "quoted_price")) ? (typeof a.quoted_price === "number" ? (a.quoted_price as number) : null) : (a.quoted_price as number),
      contact_id: isNaN(int(a, "contact_id")) ? null : int(a, "contact_id"),
    });
    const got = getJob(id);
    return `Created job #${id}.\n${got ? jobDetail(got) : ""}`;
  }
  const id = int(a, "job_id");
  if (isNaN(id)) return "Error: this jobs action needs `job_id`.";
  if (action === "get") {
    const got = getJob(id);
    return got ? jobDetail(got) : `Job #${id} not found.`;
  }
  if (action === "update") {
    const fields: Record<string, unknown> = {};
    for (const k of ["title", "client", "location", "scope", "status"]) if (str(a, k)) fields[k] = str(a, k);
    if (typeof a.quoted_price === "number") fields.quoted_price = a.quoted_price;
    if (!isNaN(int(a, "contact_id"))) fields.contact_id = int(a, "contact_id");
    updateJob(id, fields);
    return `Updated job #${id}.`;
  }
  if (action === "set_status") {
    const status = str(a, "status");
    if (!status) return "Error: set_status needs `status`.";
    updateJob(id, { status });
    return `Job #${id} → ${status}.`;
  }
  if (action === "mark_paid") {
    const paid = a.paid !== false;
    setPaid(id, paid);
    return `Job #${id} marked ${paid ? "PAID" : "unpaid"}.`;
  }
  if (action === "add_item") {
    const desc = str(a, "description");
    if (!desc) return "Error: add_item needs `description`.";
    const qty = typeof a.qty === "number" ? a.qty : 1;
    const price = typeof a.unit_price === "number" ? a.unit_price : 0;
    const liId = addLineItem(id, desc, qty, price);
    return `Added line item #${liId} to job #${id}: ${desc} — ${qty} × ${money(price)} = ${money(qty * price)}.`;
  }
  return `Error: unknown jobs action "${action}".`;
}

function jobDetail(g: NonNullable<ReturnType<typeof getJob>>): string {
  const { job, contact, items, invoices } = g;
  const lines = [
    `#${job.id} ${job.title || "(untitled)"} [${job.status || "lead"}]${job.paid ? " · PAID" : ""}`,
    contact ? `Contact: ${contact.name || "?"}${contact.phone ? ` (${contact.phone})` : ""}` : job.client ? `Client: ${job.client}` : "",
    job.location ? `Site: ${job.location}` : "",
    job.scope ? `Scope: ${job.scope}` : "",
    job.quoted_price ? `Quoted: ${money(job.quoted_price)}` : "",
  ].filter(Boolean);
  if (items.length) {
    lines.push("Line items:");
    for (const i of items) lines.push(`  - #${i.id} ${i.description} — ${i.qty} × ${money(i.unit_price)} = ${money(i.qty * i.unit_price)}`);
    lines.push(`  Subtotal: ${money(items.reduce((s, i) => s + i.qty * i.unit_price, 0))}`);
  }
  if (invoices.length) lines.push(`Invoices: ${invoices.map((iv) => `${iv.number} [${iv.status}] ${money(iv.total)}`).join(", ")}`);
  return lines.join("\n");
}

async function execInvoice(a: Args): Promise<string> {
  const action = str(a, "action") || "create";
  if (action === "create") {
    const jobId = int(a, "job_id");
    if (isNaN(jobId)) return "Error: invoice(create) needs `job_id`.";
    const kind = str(a, "kind") === "estimate" ? "estimate" : "invoice";
    const billerArg = str(a, "biller");
    const biller = billerArg === "sharpline" ? "sharpline" : billerArg === "tps" ? "tps" : undefined;
    const res = buildInvoice(jobId, kind, biller);
    if ("error" in res) return res.error;
    const full = getInvoice(res.id);
    if (!full) return `Created ${res.number} but couldn't reload it.`;
    return `DRAFT — review this with Dallin, then call invoice(send, invoice_id=${res.id}) only after he okays it:\n\n${formatInvoiceText(full.invoice, full.job, full.contact)}\n\n(Invoice id ${res.id}. ${full.contact?.phone ? `Will text ${full.contact.name || full.contact.phone}.` : "No contact phone set — add one before sending."})`;
  }
  const invId = int(a, "invoice_id");
  if (isNaN(invId)) return "Error: this invoice action needs `invoice_id`.";
  if (action === "get") {
    const full = getInvoice(invId);
    return full ? formatInvoiceText(full.invoice, full.job, full.contact) : `Invoice #${invId} not found.`;
  }
  if (action === "send") {
    return await sendInvoice(invId);
  }
  return `Error: unknown invoice action "${action}".`;
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

function execDocuments(a: Args): string {
  const action = str(a, "action") || "list";
  const lim = int(a, "limit");
  const limit = isNaN(lim) ? 15 : lim;
  if (action === "list") {
    const docs = listDocuments(limit);
    if (!docs.length) return "No documents on file yet. Dallin can upload one on the Documents page.";
    return (
      `${docs.length} document(s):\n` +
      docs
        .map((d) => `#${d.id} ${d.filename}${d.kind ? ` (${d.kind})` : ""}${d.summary ? ` — ${d.summary}` : ""}`)
        .join("\n")
    );
  }
  if (action === "search") {
    const q = str(a, "query").toLowerCase().trim();
    if (!q) return "Search needs a query.";
    const terms = q.match(/[a-z0-9]{2,}/g) || [q];
    const docs = listDocuments(200).filter((d) => {
      const hay = `${d.filename} ${d.summary || ""} ${d.text || ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, "")));
    });
    if (!docs.length) return `No documents match "${str(a, "query")}".`;
    return (
      `${docs.length} match(es):\n` +
      docs.slice(0, limit).map((d) => `#${d.id} ${d.filename}${d.summary ? ` — ${d.summary}` : ""}`).join("\n") +
      `\n\n(Use documents(get, document_id) to read one in full.)`
    );
  }
  if (action === "get") {
    const id = int(a, "document_id");
    if (isNaN(id)) return "Get needs a document_id (from list/search).";
    const d = getDocument(id);
    if (!d) return `No document #${id}.`;
    const text = (d.text || "").trim();
    const head = `#${d.id} ${d.filename}${d.kind ? ` (${d.kind})` : ""}${d.pages ? `, ${d.pages} pages` : ""}\n${d.summary ? `Summary: ${d.summary}\n` : ""}`;
    if (!text) return head + "\n(No extractable text — it may be a scan with unreadable content.)";
    // Cap what we hand the model so a huge contract doesn't blow the context window.
    const CAP = 12000;
    return head + "\n---\n" + (text.length > CAP ? text.slice(0, CAP) + "\n…(truncated)" : text);
  }
  return `Error: unknown documents action "${action}". Use list/search/get.`;
}

function execFinances(): string {
  const d = getDashboard();
  const m = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
  const lines: string[] = [];
  lines.push(`Revenue this month: ${m(d.revenueMtd)} (all-time paid ${m(d.revenueAll)})`);
  lines.push(`Owed to you: ${m(d.owedTotal)} across ${d.owedCount} invoice(s)`);
  if (d.owedCount) lines.push(`  aging — ${d.aging.filter((b) => b.count).map((b) => `${b.label}: ${m(b.amount)}`).join(", ") || "—"}`);
  lines.push(`Spend this month: ${m(d.expensesMtd)} · Net: ${m(d.netMtd)}`);
  if (d.expenseCats.length) lines.push(`  top categories — ${d.expenseCats.slice(0, 4).map((c) => `${c.category} ${m(c.amount)}`).join(", ")}`);
  if (d.pipeline.length) lines.push(`Pipeline — ${d.pipeline.map((p) => `${p.status}: ${p.count}${p.value ? ` (${m(p.value)})` : ""}`).join(", ")}`);
  if (d.unpaid.length) lines.push(`Oldest unpaid: ${d.unpaid.slice(0, 3).map((u) => `${u.job} ${m(u.total)} (${u.days}d)`).join("; ")}`);
  return lines.join("\n");
}

function execSubscriptions(a: Args): string {
  const action = str(a, "action") || "summary";
  const m = (n: number) => `$${(n || 0).toFixed(2)}`;

  if (action === "add") {
    const name = str(a, "name");
    if (!name) return "Need a name to add a subscription (e.g. 'Google Workspace').";
    const amtRaw = a.amount;
    const amount =
      typeof amtRaw === "number"
        ? amtRaw
        : typeof amtRaw === "string" && amtRaw.trim()
          ? Number(amtRaw.replace(/[^0-9.]/g, ""))
          : 0;
    const cadence = (CADENCES as readonly string[]).includes(str(a, "cadence")) ? str(a, "cadence") : "monthly";
    const category = str(a, "category") || "other";
    const renewal = /^\d{4}-\d{2}-\d{2}$/.test(str(a, "next_renewal")) ? str(a, "next_renewal") : null;
    getDb()
      .prepare(
        `INSERT INTO subscriptions (name, amount, cadence, category, next_renewal, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
      )
      .run(name, Number.isFinite(amount) ? amount : 0, cadence, category, renewal);
    const perMo = monthlyEquivalent(Number.isFinite(amount) ? amount : 0, cadence);
    return `Added ${name} — ${m(amount)}/${cadence === "monthly" ? "mo" : cadence}${cadence !== "monthly" ? ` (${m(perMo)}/mo)` : ""}. Monthly burn is now ${m(subscriptionSummary().monthlyBurn)}.`;
  }

  if (action === "list") {
    const subs = listSubscriptions(true);
    if (!subs.length) return "No subscriptions logged yet.";
    const lines = subs.map((s) => `• ${s.name}: ${m(s.amount)}/${s.cadence}${s.next_renewal ? ` (renews ${s.next_renewal})` : ""}`);
    const sum = subscriptionSummary();
    return `${lines.join("\n")}\n\nTotal: ${m(sum.monthlyBurn)}/mo · ${m(sum.annualBurn)}/yr across ${sum.count}.`;
  }

  if (action === "upcoming") {
    const up = upcomingRenewals(30);
    if (!up.length) return "Nothing renews in the next 30 days.";
    return `Renewing soon:\n${up.map((s) => `• ${s.next_renewal} — ${s.name} ${m(s.amount)}`).join("\n")}`;
  }

  // summary (default)
  const sum = subscriptionSummary();
  if (!sum.count) return "No subscriptions logged yet. Add one and I'll track the burn.";
  return `Recurring burn: ${m(sum.monthlyBurn)}/mo · ${m(sum.annualBurn)}/yr across ${sum.count} subscription(s).`;
}

function execPersonalFinance(a: Args): string {
  const action = str(a, "action") || "summary";
  const db = getDb();
  const m = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
  const flt = (k: string) => {
    const v = a[k];
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  if (action === "add_income") {
    const name = str(a, "name");
    const amt = flt("amount");
    const cadence = str(a, "cadence") || "biweekly";
    const person = str(a, "person") || "me";
    db.prepare(`INSERT INTO finance_income (person, source, amount, cadence, active, created_at) VALUES (?,?,?,?,1,datetime('now'))`).run(person, name || null, amt, cadence);
    return `Logged income: ${name || person} ${m(amt)}/${cadence}. Free cash flow is now ${m(getFinanceSummary().freeCashflow)}/mo.`;
  }
  if (action === "add_debt") {
    const name = str(a, "name") || "Debt";
    const bal = flt("amount");
    const apr = flt("apr");
    const min = flt("min_payment");
    db.prepare(`INSERT INTO finance_debts (name, kind, balance, apr, min_payment, active, created_at, updated_at) VALUES (?,?,?,?,?,1,datetime('now'),datetime('now'))`).run(name, "other", bal, apr, min);
    return `Added debt ${name}: ${m(bal)} at ${apr}% APR (min ${m(min)}). Total debt is now ${m(getFinanceSummary().totalDebt)}.`;
  }
  if (action === "add_bill") {
    const name = str(a, "name") || "Bill";
    const amt = flt("amount");
    const cadence = str(a, "cadence") || "monthly";
    const cat = str(a, "category") || "other";
    db.prepare(`INSERT INTO finance_bills (name, amount, cadence, category, active, created_at) VALUES (?,?,?,?,1,datetime('now'))`).run(name, amt, cadence, cat);
    return `Added bill ${name}: ${m(amt)}/${cadence}. Free cash flow is now ${m(getFinanceSummary().freeCashflow)}/mo.`;
  }
  if (action === "add_goal") {
    const name = str(a, "name") || "Goal";
    const target = flt("amount");
    const date = str(a, "target_date") || null;
    db.prepare(`INSERT INTO finance_goals (name, target_amount, target_date, saved_amount, strategy, status, created_at, updated_at) VALUES (?,?,?,0,'avalanche','active',datetime('now'),datetime('now'))`).run(name, target, date);
    const g = listFinGoals().find((x) => x.name === name);
    const fz = g ? goalFeasibility(g, getFinanceSummary().freeCashflow) : null;
    return `Set goal "${name}" — ${m(target)}${date ? ` by ${date}` : ""}.${fz ? ` Needs ${m(fz.requiredMonthly)}/mo${fz.feasible ? " — doable on current cash flow." : ` (short ${m(fz.shortfall)}/mo).`}` : ""} Open Finances to get a full game plan.`;
  }
  if (action === "debts") {
    const debts = listFinDebts().filter((d) => d.active && d.balance > 0);
    if (!debts.length) return "No debts logged yet.";
    const s = getFinanceSummary();
    const lines = debts.map((d) => `• ${d.name}: ${m(d.balance)} @ ${d.apr}% (min ${m(d.min_payment)})`);
    const pay = simulatePayoff(debts, s.freeCashflow, "avalanche");
    lines.push(`Total: ${m(s.totalDebt)} (avg ${s.weightedApr.toFixed(1)}% APR).`);
    lines.push(
      pay.paysOff && s.freeCashflow > 0
        ? `Avalanche with ${m(s.freeCashflow)}/mo extra → debt-free in ~${pay.months} months, ${m(pay.totalInterest)} total interest.`
        : `Free cash flow is ${m(s.freeCashflow)}/mo — not enough to accelerate; the minimums barely cover interest.`,
    );
    return lines.join("\n");
  }
  if (action === "goals") {
    const s = getFinanceSummary();
    const goals = listFinGoals().filter((g) => g.status === "active");
    if (!goals.length) return "No savings goals set yet.";
    return goals
      .map((g) => {
        const f = goalFeasibility(g, s.freeCashflow);
        return `• ${g.name}: ${m(g.saved_amount)}/${m(g.target_amount)}${g.target_date ? ` by ${g.target_date}` : ""} — needs ${m(f.requiredMonthly)}/mo, ${f.feasible ? "on track" : `short ${m(f.shortfall)}/mo`}`;
      })
      .join("\n");
  }

  // summary (default)
  const s = getFinanceSummary();
  const nw = getNetWorth("personal");
  const lines = [
    `Income ${m(s.monthlyIncome)}/mo · obligations ${m(s.monthlyObligations)}/mo · free cash flow ${m(s.freeCashflow)}/mo`,
    `Total debt ${m(s.totalDebt)}${s.weightedApr > 0 ? ` (avg ${s.weightedApr.toFixed(1)}% APR)` : ""}`,
    `Net worth ${m(nw.net)} (assets ${m(nw.assets)} − liabilities ${m(nw.liabilities)})`,
  ];
  const debts = listFinDebts().filter((d) => d.active && d.balance > 0);
  if (debts.length && s.freeCashflow > 0) {
    const pay = simulatePayoff(debts, s.freeCashflow, "avalanche");
    if (pay.paysOff) lines.push(`Debt-free in ~${pay.months} months putting ${m(s.freeCashflow)}/mo at it (avalanche).`);
  }
  const goals = listFinGoals().filter((g) => g.status === "active");
  if (goals.length) {
    const f = goalFeasibility(goals[0], s.freeCashflow);
    lines.push(`Goal "${goals[0].name}": needs ${m(f.requiredMonthly)}/mo, ${f.feasible ? "on track" : `short ${m(f.shortfall)}/mo`}.`);
  }
  if (s.monthlyIncome === 0 && !debts.length) lines.push(`(Nothing logged yet — add income/debts/bills on the Finances page or tell me and I'll log them.)`);
  return lines.join("\n");
}

// Dispatch a single tool call by name. Returns the string result for the model.
// onStatus (optional) lets a long-running tool stream live progress to the chat's
// status line — currently only deep_research uses it ("Reading wsj.com").
export async function executeTool(
  name: string,
  args: Args,
  onStatus?: (label: string) => void,
): Promise<string> {
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
      case "deep_research":
        return await execDeepResearch(args, onStatus);
      case "email":
        return await execEmail(args, onStatus);
      case "jobs":
        return await execJobs(args);
      case "invoice":
        return await execInvoice(args);
      case "finances":
        return execFinances();
      case "subscriptions":
        return execSubscriptions(args);
      case "personal_finance":
        return execPersonalFinance(args);
      case "weather":
        return await execWeather(args);
      case "memory":
        return execMemory(args);
      case "vault":
        return execVault(args);
      case "documents":
        return execDocuments(args);
      case "send_sms":
        return await execSendSms(args);
      default:
        return `Error: unknown tool "${name}".`;
    }
  } catch (e) {
    return `Error executing ${name}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
