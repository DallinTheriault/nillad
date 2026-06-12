# CLAUDE.md — Nillad project context

Nillad is **Dallin's local-first personal AI assistant** (his "JARVIS"). Everything that can run locally does; his data never leaves his Windows PC (the `daewoo` machine). Single-user, $0-marginal-cost goal. This file orients Claude; **`STATUS.md` is the running handoff log — read it first to resume** (it has the dated changelog of every feature + the current "what's next").

> The README.md is the public/portfolio narrative (human-facing). This file is the engineering reference.

---

## Architecture

- **`nillad-dashboard`** — Next.js 15 (App Router) mobile-first PWA, **the app you touch**. Containerized. Port **3100** (phone: `daewoo:8081`, HTTPS via Tailscale Serve `:8444`). This repo.
- **Ollama** — local model `gemma4:12b-it-qat` on the RTX 5080, the "brain". Port 11434.
- **One shared SQLite DB** — `C:/Projects/Axiom/Axiom/nillad.db` (= `/vault/nillad.db` in containers). Single source of truth. The vault folder is also Dallin's Obsidian "Axiom" vault (markdown notes Nillad can read/write).
- **n8n** (+ postgres) — automation/cron + inbound-SMS webhook. Port 5678.
- **ntfy** — push. 8090 (HTTPS `:8445`). **Twilio** — SMS (via n8n). **Tailscale** — private remote access + a public **Funnel** (`https://daewoo.tail541885.ts.net`) for the Stripe webhook + OAuth callbacks.
- Support containers: **SearXNG** (search, :8888), **Kokoro** (TTS, :8880), **Whisper** (STT, :9000). **host-shell-agent.cjs** (native node, :7717) runs host PowerShell for the `/terminal` page.
- Boots via `Start-Nillad.ps1` (desktop launcher). Deploy a code change: **`docker compose up -d --build`**.

## Chat architecture (important)

The dashboard does **NOT** route chat through Open WebUI. It talks **directly to Ollama** and runs the function-calling tool loop itself:

- `app/api/chat/route.ts` → **`lib/agent.ts`** (`runAgentStream`) → native tool loop vs Ollama `/api/chat` (`think:false`), streams OpenAI-style SSE.
- **`lib/nillad-tools.ts`** — the tools, **multiplexed** (each top-level tool has an `action` enum; fewer top-level tools = reliable gemma selection). Executors hit `nillad.db` directly + n8n for SMS. Tool list: `get_time, reminders, activities, calendar, jobs_contacts, web_search, deep_research, email, jobs, invoice, finances, subscriptions, personal_finance, weather, memory, vault, documents, send_sms`.
- To add/extend a tool: edit the schema in `TOOL_SCHEMAS`, the `exec*` function, the dispatch `switch` in `executeTool`, **and** the agent-prompt bullet + status label in `lib/agent.ts`. (gemma won't use a tool the prompt doesn't describe — and don't let it claim success it didn't get from a tool result.)

## Non-negotiable constraints

- **SQLite `journal_mode = DELETE`, never WAL.** The DB is shared across containers over a Windows bind mount where WAL's `-shm` isn't coherent → fresh openers (n8n) fail with disk-I/O errors. Enforced in `lib/db.ts`, `scripts/migrate.ts`. Do not reintroduce WAL anywhere touching nillad.db.
- **Nillad never auto-sends.** Outbound SMS / approvals / invoices only fire from a user-directed action; inbound SMS goes through n8n and never reaches the agent. Structural guardrail, not just a prompt.
- **Defensive reads.** Dashboard/home/finance queries are each `try/caught` (a missing/empty table returns zeros, never crashes the page). Mirror this pattern.
- **Migrations** (`scripts/migrate.ts`, `npm run migrate`) are idempotent: `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE ADD COLUMN` (ALTER only takes constant defaults). Run with `NILLAD_DB=C:/Projects/Axiom/Axiom/nillad.db`.
- **Date/time** is Denver-local ISO via `lib/datetime.ts`; the system prompt is stamped with the current date each request.

## Feature map (subsystem → key files)

- **Chat** — `app/chat/*`, `lib/agent.ts`, `lib/nillad-tools.ts`; persists to `chats`/`chat_messages`, resume at `/chat/[id]`.
- **Home** — `app/page.tsx`: the **black-hole brain** (`components/black-hole.tsx`, a WebGL raymarched lensing black hole — the animated centerpiece), heads-up alerts, "Continue" recent-chats, floating suggestion chips. Context in `lib/home-context.ts`.
- **SMS/Messages** — `app/messages/*`, `sms_threads`/`sms_messages`; send via `lib/n8n.ts` → Twilio. Inbound via n8n webhook (HMAC-**SHA1**).
- **Reminders / Calendar / Activities** — `reminders` (timed, n8n dispatcher), `calendar_events`, `activities`+`tasks` (projects/checklists; `activities(complete)` finishes a whole activity). Geo reminders via iOS Shortcut → `/api/location/arrive`.
- **Jobs & Invoices** — `lib/jobs.ts`, `app/jobs/*`; estimates/invoices, two billers (TPS default / Sharpline for paint-only), no tax, printable `/invoice/[id]`.
- **Stripe pay-by-card** — `lib/stripe.ts` (dependency-free: raw REST + node crypto), webhook `app/api/stripe/webhook/route.ts` (auto-marks invoice+job paid), keys in the `connections` registry (provider=stripe). Public via Tailscale Funnel `/api/stripe/webhook`.
- **Expenses** — `app/expenses/*`, receipt vision-scan; `expenses.scope` = business|personal.
- **Subscriptions** — `lib/subscriptions.ts`, `app/subscriptions/*`; recurring costs, monthly/annual burn; `scope` business|personal.
- **Business dashboard** — `/dashboard`, `lib/dashboard.ts` (revenue/owed-aging/spend/net/pipeline + business net worth).
- **Personal finances hub** — `/finances`, `lib/finance.ts` (STRICTLY separate from business): income/debts/bills/goals, budget + **debt-payoff simulation** (avalanche/snowball) + savings-goal feasibility → gemma "game plan" → one-tap activity. **Net worth** (assets − liabilities) on BOTH dashboards via shared `components/net-worth-card.tsx`.
- **Email** — `lib/email.ts` (IMAP via imapflow, gemma triage), `/inbox`, `connections` registry (`/connections`); OAuth (Gmail/Outlook) pending. Documents: `lib/documents.ts` (PDF/docx/image OCR), `/documents`.
- **Search** (`/search`, `lib/search.ts`, cross-source), **Vault** (`lib/vault.ts`, Obsidian notes), **Gallery** (`/gallery`), **Briefing** (6:30am cron) / **Evening review** (5:30pm), **Approvals/automations** (`/approvals`, drafts gated on one-tap approval), **DB backups** (nightly), **Voice mode** (Kokoro TTS + Whisper STT, `app/chat/voice-mode.tsx`), **Terminal** (`/terminal` → host-shell-agent).

## Conventions

- UI tokens: `bone`/`bone-dim`/`bone-mute` (text), `periwinkle`/`periwinkle-soft` + `warmred`/`red-soft` (accents), `surface`/`border`. Cards: `.nf-card`/`.nf-tile`/`.nf-bar`; glass overlays: `.nf-glass`. Bottom sheets: `components/sheet.tsx` (`Sheet`/`Field`).
- Auth: PIN → signed cookie (`lib/auth.ts`); page-level `isAuthed()`; middleware does a cookie-presence check and exempts the key-gated cron/webhook routes (`/api/briefing|evening|email|backup|automations|stripe|location|contacts/import`).
- **Verifying auth'd pages without a browser:** mint a session cookie with `NF_SESSION_SECRET` HMAC and `curl --cookie` (WebGL/animation won't render in a fetch — eyeball those on device).
- Prefer **dependency-free** implementations (vCard parser, Stripe REST, ntfy) over SDKs, matching the existing style.

## Build / run

- `docker compose up -d --build` — rebuild + deploy the dashboard.
- **Demo mode** (screenshots): `node scripts/seed-demo.cjs <realDb> <demoDb>` builds a generic seeded DB, then `docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build` points the app at it (+ generic biz contact env); `docker compose up -d` returns to real data (`NILLAD_DB=${NILLAD_DB:-/vault/nillad.db}`). Never leave demo mode on overnight (crons read the active DB).
- `components/black-hole.tsx` is the WebGL brain — used on the home AND in voice mode (`<BlackHole getIntensity={…}>` drives its flare from voice amplitude). `.tsx.bak` is a lighter fallback if a device can't run the high-detail shader.
- `npm run migrate` (with `NILLAD_DB=…`) — apply schema. `npx tsc --noEmit` — typecheck.
- Repo is **public** (`github.com/DallinTheriault/nillad`); secrets live in `.env` (gitignored) + the `connections`/`nf_auth` DB tables, not in code.
