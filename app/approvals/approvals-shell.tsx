"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, X, DollarSign, UserCheck, Loader2, CheckCircle2 } from "lucide-react";
import { approve, dismiss } from "./actions";

type Action = {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  draft_body: string | null;
  created_at: string;
};

function kindMeta(kind: string) {
  if (kind === "invoice_nudge")
    return { icon: DollarSign, label: "Payment nudge", tone: "text-emerald-400" };
  return { icon: UserCheck, label: "Lead follow-up", tone: "text-periwinkle-soft" };
}

export function ApprovalsShell({ actions }: { actions: Action[] }) {
  const router = useRouter();
  // local editable draft bodies, keyed by action id
  const [drafts, setDrafts] = useState<Record<number, string>>(
    Object.fromEntries(actions.map((a) => [a.id, a.draft_body || ""])),
  );
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onSend(a: Action) {
    setBusy(a.id);
    const res = await approve(a.id, drafts[a.id] ?? a.draft_body ?? "");
    setBusy(null);
    setToast(res.message);
    if (res.ok) router.refresh();
    setTimeout(() => setToast(null), 3500);
  }

  function onDismiss(id: number) {
    startTransition(async () => {
      await dismiss(id);
      router.refresh();
    });
  }

  if (!actions.length) {
    return (
      <div className="px-3">
        <div className="mt-16 flex flex-col items-center text-center">
          <CheckCircle2 size={40} className="text-bone-mute" />
          <p className="mt-3 text-[15px] font-medium text-bone-dim">Nothing waiting on you</p>
          <p className="mt-1 max-w-xs text-[13px] text-bone-mute">
            When an invoice goes unpaid or a lead goes quiet, Nillad drafts a message here for your
            one-tap approval. It never sends without you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3">
      <p className="px-1 pb-3 text-[12.5px] text-bone-mute">
        Nillad drafted these for you. Edit if you like, then send — or dismiss. Nothing goes out
        until you tap Send.
      </p>
      <div className="space-y-3">
        {actions.map((a) => {
          const { icon: Icon, label, tone } = kindMeta(a.kind);
          return (
            <div key={a.id} className="rounded-2xl border border-border bg-surface p-3.5">
              <div className="flex items-start gap-2">
                <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
                  </div>
                  <h3 className="mt-0.5 text-[14px] font-medium leading-snug text-bone">{a.title}</h3>
                  {a.detail ? <p className="mt-0.5 text-[12px] text-bone-dim">{a.detail}</p> : null}
                  <p className="mt-1 text-[11.5px] text-bone-mute">
                    To {a.recipient_name || "—"}
                    {a.recipient_phone ? ` · ${a.recipient_phone}` : ""}
                  </p>
                </div>
              </div>

              <textarea
                value={drafts[a.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                rows={4}
                className="mt-2.5 w-full resize-y rounded-xl border border-border-strong bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed text-bone outline-none focus:border-periwinkle/70"
              />

              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => onSend(a)}
                  disabled={busy === a.id || !(drafts[a.id] ?? "").trim() || !a.recipient_phone}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-periwinkle py-2.5 text-[14px] font-medium text-white hover:bg-periwinkle-soft transition-colors disabled:opacity-50"
                >
                  {busy === a.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                  {busy === a.id ? "Sending…" : "Approve & Send"}
                </button>
                <button
                  onClick={() => onDismiss(a.id)}
                  disabled={busy === a.id}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border-strong px-3.5 py-2.5 text-[14px] text-bone-dim hover:text-bone hover:border-bone-mute transition-colors disabled:opacity-50"
                >
                  <X size={15} /> Dismiss
                </button>
              </div>
              {!a.recipient_phone ? (
                <p className="mt-1.5 text-[11.5px] text-red-soft">No phone on this contact — add one in Contacts to send.</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {toast ? (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
          <div className="rounded-full border border-border-strong bg-surface-2 px-4 py-2 text-[13px] text-bone shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
