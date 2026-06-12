"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Mail,
  AtSign,
  Code,
  Rss,
  Plug,
  Plus,
  Trash2,
  Power,
  ChevronRight,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import {
  PROVIDERS,
  KIND_ORDER,
  KIND_LABELS,
  providerById,
  type ConnKind,
  type ConnectionView,
  type Provider,
} from "@/lib/connections";
import { addConnection, deleteConnection, toggleConnection } from "./actions";

const KIND_ICON: Record<ConnKind, LucideIcon> = {
  email: Mail,
  social: AtSign,
  api: Code,
  feed: Rss,
  other: Plug,
};

export function ConnectionsShell({ connections }: { connections: ConnectionView[] }) {
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<ConnectionView | null>(null);

  const byKind = useMemo(() => {
    const m = new Map<ConnKind, ConnectionView[]>();
    for (const k of KIND_ORDER) m.set(k, []);
    for (const c of connections) m.get(c.kind)?.push(c);
    return m;
  }, [connections]);

  return (
    <>
      <p className="px-5 pt-1 pb-3 text-[13px] leading-snug text-bone-dim">
        Sources Nillad can read and analyze. IMAP mail, REST APIs and RSS finish here; Gmail,
        Outlook and socials need a quick desktop sign-in (added as <em>pending</em>).
      </p>

      <div className="px-4 space-y-5">
        {KIND_ORDER.map((kind) => {
          const items = byKind.get(kind) || [];
          const Icon = KIND_ICON[kind];
          return (
            <section key={kind}>
              <div className="flex items-center gap-2 px-1 mb-2">
                <Icon size={14} className="text-bone-mute" />
                <h2 className="text-[11px] uppercase tracking-[0.18em] text-bone-mute font-mono">
                  {KIND_LABELS[kind]}
                </h2>
                <span className="text-[11px] text-bone-mute font-mono">{items.length || ""}</span>
              </div>
              {items.length === 0 ? (
                <p className="px-1 text-xs text-bone-mute">None yet.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setManaging(c)}
                        className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-bone truncate">{c.label}</div>
                          <div className="text-[12px] text-bone-dim truncate">
                            {c.providerName}
                            {c.summary ? ` · ${c.summary}` : ""}
                          </div>
                        </div>
                        <StatusBadge status={c.status} needsDesktop={c.needsDesktop} />
                        <ChevronRight size={16} className="text-bone-mute shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <FloatingAddButton onClick={() => setAdding(true)} />

      {adding && <AddDrawer onClose={() => setAdding(false)} />}
      {managing && <ManageDrawer conn={managing} onClose={() => setManaging(null)} />}
    </>
  );
}

function StatusBadge({
  status,
  needsDesktop,
}: {
  status: ConnectionView["status"];
  needsDesktop: boolean;
}) {
  const map: Record<ConnectionView["status"], { label: string; cls: string }> = {
    active: { label: "Ready", cls: "text-periwinkle" },
    pending: { label: needsDesktop ? "Desktop setup" : "Pending", cls: "text-amber-400" },
    error: { label: "Error", cls: "text-warmred" },
    disabled: { label: "Off", cls: "text-bone-mute" },
  };
  const s = map[status];
  return (
    <span
      className={`shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] ${s.cls} inline-flex items-center gap-1`}
    >
      {status === "pending" && needsDesktop && <Monitor size={11} />}
      {s.label}
    </span>
  );
}

function FloatingAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Add connection"
      className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center z-10 shadow-lg"
      style={{
        background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
        boxShadow: "0 8px 24px rgba(98,92,200,0.35)",
      }}
    >
      <Plus size={22} className="text-bone" />
    </button>
  );
}

function AddDrawer({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<Provider | null>(null);

  if (!picked) {
    return (
      <Sheet title="Add a source" onClose={onClose}>
        <div className="space-y-4">
          {KIND_ORDER.map((kind) => {
            const provs = PROVIDERS.filter((p) => p.kind === kind);
            if (!provs.length) return null;
            return (
              <div key={kind}>
                <div className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono mb-1.5">
                  {KIND_LABELS[kind]}
                </div>
                <div className="space-y-1.5">
                  {provs.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPicked(p)}
                      className="w-full text-left px-3 py-2.5 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-bone">{p.name}</span>
                        {p.needsDesktop && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400">
                            <Monitor size={10} /> desktop
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-bone-dim mt-0.5">{p.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Sheet>
    );
  }

  return <ConfigureForm provider={picked} onBack={() => setPicked(null)} onClose={onClose} />;
}

function ConfigureForm({
  provider,
  onBack,
  onClose,
}: {
  provider: Provider;
  onBack: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of provider.fields) if (f.default) init[f.key] = f.default;
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await addConnection(provider.id, label, values);
      if (r.ok) onClose();
      else setError(r.error || "Failed");
    });
  }

  return (
    <Sheet title={provider.name} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {provider.needsDesktop && (
          <p className="text-[12px] text-amber-400/90 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
            Saved as <strong>pending</strong> — finish the sign-in on desktop to activate it.
          </p>
        )}
        <Field label="Name">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={provider.name}
            className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
          />
        </Field>
        {provider.fields.map((f) => (
          <Field key={f.key} label={f.label + (f.required ? "" : " (optional)")}>
            <input
              type={f.type === "password" ? "password" : f.type === "number" ? "number" : f.type === "url" ? "url" : "text"}
              inputMode={f.type === "number" ? "numeric" : undefined}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              autoComplete={f.secret ? "new-password" : "off"}
              className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
            />
          </Field>
        ))}
        <div className="flex items-center justify-between pt-2 gap-3">
          <button type="button" onClick={onBack} className="text-bone-dim text-sm hover:text-bone transition">
            Back
          </button>
          <button
            type="submit"
            disabled={pending}
            className="gradient-pill px-5 py-2 text-sm font-medium tracking-wide"
          >
            {pending ? "Saving…" : "Add source"}
          </button>
        </div>
        {error && <p className="text-xs text-warmred font-mono text-center">{error}</p>}
      </form>
    </Sheet>
  );
}

function ManageDrawer({ conn, onClose }: { conn: ConnectionView; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const provider = providerById(conn.provider);

  function remove() {
    startTransition(async () => {
      await deleteConnection(conn.id);
      onClose();
    });
  }
  function toggle() {
    startTransition(async () => {
      await toggleConnection(conn.id);
      onClose();
    });
  }

  return (
    <Sheet title={conn.label} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-surface/40 px-3 py-3 space-y-1">
          <Row k="Type" v={conn.providerName} />
          {conn.summary && <Row k="Account" v={conn.summary} />}
          <Row k="Status" v={conn.status === "active" ? "Ready" : conn.status} />
          {conn.last_sync_at && <Row k="Last read" v={conn.last_sync_at} />}
          {conn.last_error && <Row k="Last error" v={conn.last_error} />}
        </div>

        {provider?.needsDesktop && conn.status === "pending" && (
          <p className="text-[12px] text-amber-400/90 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
            This source needs a one-time sign-in on the desktop to activate.
          </p>
        )}

        <div className="flex items-center justify-between pt-1 gap-3">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-warmred text-sm hover:text-warmred-soft transition"
          >
            <Trash2 size={14} /> Remove
          </button>
          {(conn.status === "active" || conn.status === "disabled") && (
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className="inline-flex items-center gap-1.5 gradient-pill px-4 py-2 text-sm font-medium"
            >
              <Power size={14} /> {conn.status === "active" ? "Disable" : "Enable"}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-bone-mute">{k}</span>
      <span className="text-bone text-right truncate">{v}</span>
    </div>
  );
}
