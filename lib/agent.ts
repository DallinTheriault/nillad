// Nillad's chat agent. Talks DIRECTLY to Ollama (native function-calling),
// runs the tool loop dashboard-side, and emits an OpenAI-style SSE stream so the
// existing chat-view client is unchanged.
//
// Why direct-to-Ollama instead of Open WebUI:
//   - OWUI's `default` function-calling adds ~3-4s of orchestration + RAG/citation
//     scaffolding per request (measured), and gemma fumbles tool selection there.
//   - reasoning_effort:"high" on the `axiom` model made every reply generate a
//     large hidden chain-of-thought (3.9s vs 0.3s for a trivial reply). We run
//     with think:false for snappy replies; tool selection stays reliable thanks
//     to a focused system prompt + tight tool schemas.

import {
  DEFAULT_TOOLS,
  executeTool,
  toolSchemasFor,
  type ToolSchema,
} from "@/lib/nillad-tools";
import { humanDenver, toDenverIso } from "@/lib/datetime";
import { vaultIndex } from "@/lib/vault";
import { gateAutoMemory, autoCapture } from "@/lib/automemory";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";
const MAX_TOOL_ROUNDS = 5;

export type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
export type ChatMsg = { role: "user" | "assistant" | "system"; content: ChatContent };

export function agentConfigured(): boolean {
  return MODEL.length > 0;
}

// Persona scoped to the tools the dashboard actually implements. Deliberately
// omits the calendar/memory/weather instructions from the OWUI `axiom` prompt —
// those tools aren't wired here, and promising them makes Nillad lie.
const SYSTEM_PROMPT = `You are Nillad, Dallin's personal AI assistant and second brain — not a general chatbot. Help him think, organize, decide, and act, and quietly keep his reminders, activities, contacts and messages in order through your tools.

## Tools — actually call them, don't just narrate
You have these tools. Pick the most specific one for the request and just use it; don't announce that you're about to.

CRITICAL: To set a reminder, add a calendar event, log/complete an activity, or send a text, you MUST call the corresponding tool. NEVER say you've set, added, scheduled, saved, or sent something unless you called the tool THIS turn and it returned success. Knowing the current time does not mean a reminder exists — you still have to call reminders(set). If you only talked about it, it did not happen.

CRITICAL (vault): You CAN access Dallin's local Obsidian notes through the vault tool. If he asks whether you can see his vault/notes, or asks anything about what's in them, you MUST call vault(search) or vault(list) FIRST and answer from the result. NEVER reply that you "can't access local files / private vaults" or that "no tool is linked" — that is false, the tool is right here. Do not repeat a previous "I can't" answer; just try the tool.
- get_time — the current date/time. Only for "what time is it" or to resolve a relative schedule.
- reminders — set/list/cancel timed reminders. Use whenever Dallin wants to be reminded of something later.
- activities — his projects and task checklists. Use action "recent" to recall what he was working on, "add"/"note" to keep them current, "complete_task" to check off ONE task, and **"complete" to FINISH the whole activity** (when he says "finish / close / mark done the X activity" — this sets it done; pass the activity_id, or the title to match). Don't claim you finished an activity unless you actually called activities(complete) and it returned success.
- calendar — scheduled events (meetings, jobs, appointments). add/read/cancel. Resolve relative dates to explicit times, and after adding, state the resolved date/time back so he can catch a wrong one. Reminders are timed pings; calendar events are scheduled blocks — pick the one he means.
- web_search — search the live web. You CAN browse: when Dallin asks you to find, look up, or research anything external — news, prices, products, businesses, GitHub repos/projects, verifying a claim — CALL web_search and report what you actually find, with links. action 'read' pulls a page's full text when a snippet isn't enough. For GitHub, just search the public web (e.g. query 'site:github.com <terms>', or 'read' a github.com/search results page). TRY FIRST, CAVEAT SECOND: do NOT preface or replace a search with a lecture about why it might be incomplete (indexing lag, private repos, no official API, no "deep crawl", etc.), and do NOT refuse because you can't do an exhaustive/filtered crawl — a few good real results is the job. Run the search, return the best results you found, and add a brief completeness caveat ONLY if the search returns little or nothing. Default to doing the search, not explaining its limits. If web_search returns no results or an error (it can be briefly rate-limited), say so in one short sentence and offer to try again — NEVER end your turn with an empty reply.
- deep_research — multi-source research with synthesis. AUTO-CHOOSE THIS over web_search whenever a good answer needs more than one quick fact: "research X", "compare A vs B", "what's the best / cheapest / most reliable …", pros and cons, "is X worth it", buying/decision questions, or any in-depth or current topic where combining several sources matters. It plans several searches, reads the top pages, and returns cited findings — then you synthesize across them and cite the source links. Don't ask Dallin whether he wants deep research; just use it when the question warrants it. Use the lighter web_search only for a single quick lookup or to read one specific page you already have the URL for. It takes longer (that's expected) — the status line shows him the progress.
- email — Dallin's connected mailbox(es). Use whenever he asks about email/inbox: 'any important emails?', 'what's new', 'check my email', 'find the email from X', or to act on one. action 'important' = the flagged ones; 'recent' = latest; 'search' = find by sender/subject/keyword; 'get' = full details of one (by id); 'sync' = pull the newest from the server first (do this if he says "check"/"refresh" or a list looks stale). Mutating: 'mark_read', 'archive', 'delete', 'move' — these act on the live mailbox by message id. DELETE and MOVE are destructive: confirm with Dallin first (name the message), then call. mark_read and archive are low-stakes — just do them when asked. If there are no mailboxes/ingested mail, say so and point him to the Connections page.
- documents — read the files Dallin has uploaded: contracts, bids, spec sheets, bills, PDFs, **Word .docx**, scanned images. You CAN read all of these — the text is already extracted for you, so NEVER say you can't open or read a file type; just use the tool. Use whenever he asks about a document or what's IN it — "what are the payment terms in that contract?", "summarize the bid". documents(search, query) to find the right file, then documents(get, document_id) to read its full text BEFORE answering — answer from the actual text, never guess. documents(list) to see what's on file. This is for uploaded FILES; the vault is for his own markdown notes.
- finances — Dallin's business numbers (revenue this month + all-time, money owed with aging, spend, net, jobs pipeline). Use whenever he asks how business/money is doing — "how's business this month", "how much am I owed", "what's my revenue", "who owes me", "how much have I spent". Pull this and answer from the real numbers; don't guess.
- subscriptions — Dallin's RECURRING costs (Google Workspace, domain, SaaS, phone, insurance…), separate from one-off expenses. Use to report his subscription burn ("what am I paying monthly", "what's my recurring spend"), list them, what renews soon, or ADD one he mentions ("add Google Workspace 7 a month", "domain is $20/yr"). Default action 'summary' = total monthly/annual burn.
- personal_finance — Dallin's PERSONAL / household money (his + his wife's income, debts, bills, savings goals, budget, debt payoff) — SEPARATE from the BUSINESS 'finances' tool. Use for "how's my budget / free cash flow", "how much debt", "when can I be debt-free", "am I on track for my goal", or to LOG what he tells you ("add a debt Chase $4k 24% APR min $90", "I make $1,800 biweekly", "rent is $1,500/mo", "goal save $10k by Sept 30"). Keep business and personal money separate: 'finances' = business, 'personal_finance' = household.
- weather — current conditions + short forecast (defaults to American Fork, UT).
- memory — your long-term memory. SAVE durable facts/decisions/preferences/details about people and projects when Dallin shares them or asks you to remember; RECALL before answering questions about his history or preferences; forget on request. Save the specific fact, not the whole conversation.
- vault — Dallin's Obsidian "Axiom" notes vault: his real knowledge base (folders like Memory, Projects, Goals, Decisions, Journal, Lessons, Preferences, Inbox). This is separate from your quick \`memory\` and from \`activities\`. SEARCH the vault whenever he references one of his projects/people/decisions/goals, or asks "what do I have on X / what did I write about Y" — you CAN see his notes now, so never claim you can't. READ a note for full detail; APPEND to keep a durable note or add to his journal. When he asks about his own context, check activities AND the vault before answering instead of guessing.
- jobs — manage his contracting/painting JOBS in detail: create (incl. 'from_activity' to seed a job from an activity's notes — name/address/scope), update fields, set status (lead→quoted→scheduled→active→done→invoiced→paid), add line items, mark paid. Use when he discusses a specific job he's quoting/doing/finishing. To BILL, use the invoice tool.
- invoice — create/preview/send an estimate or invoice for a job. When he says "write up an invoice for the X job", call invoice(create, job_id) → SHOW him the returned draft → only after he okays it, call invoice(send, invoice_id) to text it to the job's contact. NEVER send without showing him first and getting his ok.
- jobs_contacts — look up a contact's phone before texting, recall job details, or ADD a contact. **Dallin cannot add contacts by hand from the chat, so whenever he gives you a new person + number/email to save ("save Mike at 801-555-0112", "add my new sub Sarah"), call jobs_contacts(add_contact) and confirm.** If find_contact returns ONE contact, that IS the person Dallin meant — take its number and proceed immediately. A returned row is a confirmed match: do NOT say "I couldn't find a perfect match" or ask Dallin to confirm the contact when a contact came back. Only ask if it returns MULTIPLE people (then list them and ask which) or NONE (then say you don't have that contact).
- send_sms — send a text on Dallin's line. When Dallin explicitly tells you to text someone (e.g. "text Tanner 'on my way'"), the decision is already made: look up the number with jobs_contacts if needed, then CALL send_sms right away and report what you sent. Do NOT ask "should I send this?", "want me to send it?", or any confirmation — he already told you to; asking is wrong. Hard rule: NEVER text someone Dallin didn't ask you to, and NEVER auto-reply to an inbound text — inbound messages are his to read and direct; you only send what he explicitly tells you to.

## Acting vs asking
Default to acting on low-stakes, reversible things (setting a reminder, logging an activity, adding a task, AND sending a text Dallin explicitly directed) — then confirm in one short line including any resolved date/time or what you sent, so Dallin can catch a mistake. Resolve relative dates ("tomorrow", "Saturday") to explicit ones. Confirm first ONLY for genuinely destructive actions (cancelling a reminder, deleting a calendar event). A user-directed send is NOT one of those — never ask permission to send a text he directed; just send it. The ONLY time you ask before texting is when jobs_contacts returns several possible people or nobody — i.e. you genuinely don't know the number — never merely to double-check a send he already asked for.

## Honesty
Separate what you know from what you're guessing — say so out loud. Don't present hardware/architecture claims as settled fact. Don't reflexively agree when pushed back on. You can't change your own weights or "learn" — never promise that.

## Style
Be direct and concise. Lead with the answer. No filler, no ceremony. After saving/scheduling/sending something, confirm in one line — nothing more. Challenge weak assumptions even when Dallin sounds confident.

Dallin is a builder/general contractor (Theriault Property Services LLC; Sharpline Painting Co.) in the American Fork / Utah County area. Direct, results-oriented, wants honest pushback over validation.`;

// ---------- Ollama message shaping ----------

type OllamaMsg = {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

// Convert the client's OpenAI-style messages (string OR multimodal parts) into
// Ollama chat messages. Images become a base64 `images` array (prefix stripped).
function toOllama(messages: ChatMsg[]): OllamaMsg[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    let text = "";
    const images: string[] = [];
    for (const part of m.content) {
      if (part.type === "text") text += part.text;
      else if (part.type === "image_url") {
        const url = part.image_url.url || "";
        const comma = url.indexOf(",");
        images.push(comma >= 0 && url.startsWith("data:") ? url.slice(comma + 1) : url);
      }
    }
    return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text };
  });
}

// ---------- SSE helpers (OpenAI chat.completion.chunk shape) ----------

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// Out-of-band status line shown in the bubble while Nillad works ("Thinking…",
// "Searching the web for …"). Carries no `choices`, so the existing client (and
// any old one) safely ignores it; the updated client reads `.status.label`.
function sseStatus(label: string): string {
  return `data: ${JSON.stringify({ status: { label } })}\n\n`;
}

// Human-readable "what Nillad is doing right now" for a tool call. Pulls the
// concrete subject (the search query, the page host) so the user sees exactly
// what he's looking at — not just "using a tool".
function toolStatus(name: string, args: Record<string, unknown>): string {
  const a = args || {};
  const action = typeof a.action === "string" ? a.action : "";
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  switch (name) {
    case "web_search": {
      if (action === "read" || a.url) {
        const url = str("url");
        let host = url;
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          /* not a full URL */
        }
        return host ? `Reading ${host}` : "Reading a page";
      }
      const q = (str("query") || str("q")).slice(0, 60);
      return q ? `Searching the web for “${q}”` : "Searching the web";
    }
    case "deep_research": {
      const q = str("query").slice(0, 60);
      return q ? `Researching “${q}”` : "Researching";
    }
    case "jobs":
      return "Updating your jobs";
    case "invoice": {
      const act = str("action");
      if (act === "send") return "Sending the invoice";
      return "Writing up the invoice";
    }
    case "email": {
      const act = str("action");
      if (act === "sync") return "Checking your email";
      if (act === "search") return "Searching your email";
      if (act === "delete") return "Deleting an email";
      if (act === "archive") return "Archiving an email";
      if (act === "move") return "Moving an email";
      if (act === "mark_read") return "Marking it read";
      return "Reading your email";
    }
    case "weather": {
      const where = str("place") || str("location");
      return where ? `Checking the weather in ${where}` : "Checking the weather";
    }
    case "reminders":
      return action === "set" ? "Setting a reminder" : "Checking your reminders";
    case "calendar":
      return action === "add" ? "Adding a calendar event" : "Checking your calendar";
    case "activities":
      return "Reviewing your activity";
    case "finances":
      return "Checking your numbers";
    case "subscriptions":
      return action === "add" ? "Logging the subscription" : "Checking your subscriptions";
    case "personal_finance":
      return action.startsWith("add") ? "Logging it to your finances" : "Checking your finances";
    case "vault":
      return action === "read" ? "Reading your notes" : "Searching your vault";
    case "documents":
      return action === "get" ? "Reading the document" : "Looking through your documents";
    case "memory":
      return action === "save" ? "Saving to memory" : "Checking my memory";
    case "jobs_contacts":
      return "Looking up a contact";
    case "send_sms":
      return "Sending a text";
    case "get_time":
      return "Checking the time";
    default:
      return "Working on it";
  }
}

// ---------- One streaming turn against Ollama ----------

type TurnResult = {
  content: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
};

// Streams one assistant turn. Forwards text deltas via onText as they arrive and
// collects any tool calls. gemma emits tool-call turns with empty content, so
// nothing leaks to the user before a tool runs.
async function streamTurn(
  messages: OllamaMsg[],
  tools: ToolSchema[],
  onText: (t: string) => void,
  think: boolean,
): Promise<TurnResult> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      // think:false → snappy ~1-2s replies (default). think:true lets gemma run a
      // full chain-of-thought first ("think harder"): slower, but stronger on
      // genuinely hard reasoning. The thinking tokens arrive in message.thinking
      // and are intentionally NOT streamed to the user — only the final answer is.
      think,
      stream: true,
      options: { temperature: 0.6 },
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  const toolCalls: TurnResult["toolCalls"] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let obj: {
        message?: {
          content?: string;
          tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
        };
      };
      try {
        obj = JSON.parse(s);
      } catch {
        continue;
      }
      const msg = obj.message;
      if (!msg) continue;
      if (msg.content) {
        content += msg.content;
        onText(msg.content);
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({ name: tc.function.name, args: tc.function.arguments || {} });
        }
      }
    }
  }
  return { content, toolCalls };
}

// ---------- Public: run the agent and return an SSE ReadableStream ----------

export function runAgentStream(
  clientMessages: ChatMsg[],
  toolNames: string[] = DEFAULT_TOOLS,
  think = false,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const tools = toolSchemasFor(toolNames);
  // Ground the model in the current date/time so it resolves relative dates
  // ("tomorrow", "Saturday") correctly instead of guessing — a 12B with no clock
  // will otherwise hallucinate the year/month when filling a calendar/reminder time.
  const now = new Date();
  let vIndex = "";
  try {
    vIndex = `\n\n${vaultIndex()}`;
  } catch {
    /* vault unreadable — omit the index, the tool still works */
  }
  const dated = `${SYSTEM_PROMPT}\n\nRight now it is ${humanDenver(now)} (${toDenverIso(now)}, America/Denver). Resolve relative dates/times against this and pass explicit ISO 8601 values to tools.${vIndex}`;
  const messages: OllamaMsg[] = [{ role: "system", content: dated }, ...toOllama(clientMessages)];

  // The last user message — fed to the gated auto-memory pass after the reply.
  const lastUser = [...clientMessages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUser
    ? typeof lastUser.content === "string"
      ? lastUser.content
      : lastUser.content.map((p) => (p.type === "text" ? p.text : "")).join(" ")
    : "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (chunk: string) => controller.enqueue(enc.encode(chunk));
      let finalText = "";
      try {
        // Initial state shown in the bubble before anything streams back.
        emit(sseStatus(think ? "Thinking harder…" : "Thinking…"));
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const isLast = round === MAX_TOOL_ROUNDS - 1;
          // On the final allowed round, drop tools so the model is forced to answer.
          const turn = await streamTurn(messages, isLast ? [] : tools, (t) => emit(sseDelta(t)), think);

          if (turn.toolCalls.length === 0) {
            finalText = turn.content; // final answer (already streamed)
            break;
          }

          // Record the assistant's tool-call turn, then execute each tool and
          // append its result, then loop to let the model use the results.
          messages.push({
            role: "assistant",
            content: turn.content,
            tool_calls: turn.toolCalls.map((tc) => ({
              function: { name: tc.name, arguments: tc.args },
            })),
          });
          for (const tc of turn.toolCalls) {
            // Tell the user exactly what he's doing right now (e.g. the search query).
            emit(sseStatus(toolStatus(tc.name, tc.args)));
            // Long tools (deep_research) stream their own per-step status via the callback.
            const result = await executeTool(tc.name, tc.args, (label) => emit(sseStatus(label)));
            messages.push({ role: "tool", content: result, tool_name: tc.name });
          }
          // Tools done for this round — back to composing the answer.
          emit(sseStatus(think ? "Thinking harder…" : "Thinking…"));
        }
        // Passive memory capture — gated, fire-and-forget so it never blocks the reply.
        if (gateAutoMemory(lastUserText)) void autoCapture(lastUserText, finalText).catch(() => {});
        emit("data: [DONE]\n\n");
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Surface the error inline so the user sees something rather than a hang.
        emit(sseDelta(`\n\n[Nillad error: ${msg}]`));
        emit("data: [DONE]\n\n");
        controller.close();
      }
    },
  });
}
