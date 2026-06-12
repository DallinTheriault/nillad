// The "Connections" hub: a registry of external sources Dallin wants Nillad to
// read and analyze — mailboxes, social accounts, REST APIs, RSS feeds, and
// whatever else gets added later. This file is the SOURCE CATALOG (what can be
// connected + which fields each needs) plus small typed read helpers. The page,
// server actions, and (later) per-provider ingestion build on it.
//
// Design: a connection is generic — kind + provider + a JSON bag of config and a
// separate JSON bag of secrets. Adding a new source = adding one entry to
// PROVIDERS below; the add-form renders itself from the field list. No new table
// or component per provider.

export type ConnKind = "email" | "social" | "api" | "feed" | "other";

export type FieldType = "text" | "password" | "number" | "url";

export type ProviderField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  secret?: boolean; // stored in `secret`, never sent back to the client
  default?: string;
};

export type Provider = {
  id: string; // stored as connections.provider
  kind: ConnKind;
  name: string;
  blurb: string;
  // OAuth providers can't be finished from a phone — they need a one-time desktop
  // auth step. We still let Dallin register intent now; status starts 'pending'.
  needsDesktop?: boolean;
  fields: ProviderField[];
};

export const KIND_LABELS: Record<ConnKind, string> = {
  email: "Email",
  social: "Social",
  api: "APIs",
  feed: "Feeds",
  other: "Other",
};

export const KIND_ORDER: ConnKind[] = ["email", "social", "api", "feed", "other"];

// The catalog. Phone-completable providers (IMAP, REST, RSS) take a pasted
// credential and are ready immediately; OAuth ones are marked needsDesktop.
export const PROVIDERS: Provider[] = [
  {
    id: "imap",
    kind: "email",
    name: "IMAP mailbox",
    blurb: "Any mailbox with IMAP + an app password (incl. Gmail app passwords). Finishable here.",
    fields: [
      { key: "host", label: "IMAP host", type: "text", required: true, placeholder: "imap.gmail.com" },
      { key: "port", label: "Port", type: "number", default: "993" },
      { key: "username", label: "Email / username", type: "text", required: true, placeholder: "you@gmail.com" },
      { key: "password", label: "App password", type: "password", required: true, secret: true },
    ],
  },
  {
    id: "gmail",
    kind: "email",
    name: "Gmail (OAuth)",
    blurb: "Full Gmail access (read, label, archive, delete) via Google OAuth. Needs a desktop auth step.",
    needsDesktop: true,
    fields: [
      { key: "account", label: "Account email", type: "text", required: true, placeholder: "you@getfield.co" },
    ],
  },
  {
    id: "outlook",
    kind: "email",
    name: "Outlook / live.com (OAuth)",
    blurb: "Microsoft Graph (personal live.com or work). Needs a desktop auth step.",
    needsDesktop: true,
    fields: [
      { key: "account", label: "Account email", type: "text", required: true, placeholder: "dallintheriault@live.com" },
    ],
  },
  {
    id: "x",
    kind: "social",
    name: "X / Twitter",
    blurb: "Read your timeline/mentions. Paste an API bearer token, or finish OAuth on desktop.",
    fields: [
      { key: "handle", label: "Handle", type: "text", required: true, placeholder: "@dallin" },
      { key: "bearer", label: "API bearer token (optional)", type: "password", secret: true },
    ],
  },
  {
    id: "reddit",
    kind: "social",
    name: "Reddit",
    blurb: "Read saved posts / a user or subreddit feed via the Reddit API.",
    fields: [
      { key: "username", label: "Username", type: "text", required: true, placeholder: "u/dallin" },
      { key: "client_id", label: "App client id (optional)", type: "text" },
      { key: "client_secret", label: "App secret (optional)", type: "password", secret: true },
    ],
  },
  {
    id: "rest",
    kind: "api",
    name: "REST API / webhook",
    blurb: "Any JSON endpoint Nillad should pull from. Finishable here.",
    fields: [
      { key: "base_url", label: "Base URL", type: "url", required: true, placeholder: "https://api.example.com/v1" },
      { key: "auth_header", label: "Auth header name", type: "text", default: "Authorization" },
      { key: "api_key", label: "API key / token", type: "password", secret: true },
    ],
  },
  {
    id: "stripe",
    kind: "api",
    name: "Stripe (card payments)",
    blurb:
      "Accept card payments on invoices. Paste a secret/restricted key (needs Prices + Payment Links write). Add the webhook signing secret after I give you the endpoint URL.",
    fields: [
      { key: "biller", label: "Which business (tps or sharpline)", type: "text", required: true, placeholder: "tps", default: "tps" },
      { key: "api_key", label: "Secret/restricted key (sk_live_… or rk_live_…)", type: "password", required: true, secret: true },
      { key: "webhook_secret", label: "Webhook signing secret (whsec_… — add after setup)", type: "password", secret: true },
    ],
  },
  {
    id: "rss",
    kind: "feed",
    name: "RSS / Atom feed",
    blurb: "A feed Nillad watches (news, a blog, a status page). Finishable here.",
    fields: [
      { key: "url", label: "Feed URL", type: "url", required: true, placeholder: "https://example.com/feed.xml" },
    ],
  },
  {
    id: "custom",
    kind: "other",
    name: "Custom source",
    blurb: "Anything else — describe it and Nillad will note it until we wire it up.",
    fields: [
      { key: "details", label: "What is it / where", type: "text", required: true, placeholder: "e.g. my Notion workspace" },
      { key: "secret_value", label: "Token / key (optional)", type: "password", secret: true },
    ],
  },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// Shape sent to the client list (NEVER includes `secret`).
export type ConnectionView = {
  id: number;
  kind: ConnKind;
  provider: string;
  providerName: string;
  label: string;
  status: "pending" | "active" | "error" | "disabled";
  summary: string; // a one-line, secret-free description (e.g. the username/host)
  needsDesktop: boolean;
  last_sync_at: string | null;
  last_error: string | null;
};

// Build the secret-free one-liner shown under each connection.
export function summarize(provider: Provider | undefined, config: Record<string, string>): string {
  if (!provider) return "";
  const first =
    config.username || config.account || config.handle || config.base_url || config.url || config.details || "";
  return first;
}
