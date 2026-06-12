"use client";

import { useMemo, useState, useTransition } from "react";
import {
  RefreshCw,
  MailOpen,
  Archive,
  Trash2,
  FolderInput,
  AlertCircle,
  BellPlus,
  type LucideIcon,
} from "lucide-react";
import { Sheet, Field } from "@/components/sheet";
import { syncNow, markRead, archive, remove, move, remindAboutEmail } from "./actions";

export type EmailRow = {
  id: number;
  from_name: string | null;
  from_addr: string | null;
  subject: string | null;
  date: string | null;
  summary: string | null;
  snippet: string | null;
  importance: "high" | "normal" | "low";
  important: number;
  seen: number;
  reason: string | null;
  mailbox: string;
};

type Filter = "all" | "important" | "unread";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function InboxShell({ rows }: { rows: EmailRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<EmailRow | null>(null);
  const [syncing, startSync] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      rows.filter((r) =>
        filter === "important" ? r.important : filter === "unread" ? !r.seen : true,
      ),
    [rows, filter],
  );
  const multiBox = useMemo(() => new Set(rows.map((r) => r.mailbox)).size > 1, [rows]);

  function doSync() {
    setNote(null);
    startSync(async () => {
      const r = await syncNow();
      if (!r.ok) setNote(r.error || "Sync failed.");
      else setNote(`${r.added} new${r.flagged ? `, ${r.flagged} important` : ""}.${r.error ? ` (${r.error})` : ""}`);
    });
  }

  return (
    <>
      <div className="px-4 pt-3 flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto flex-1">
          {(["all", "important", "unread"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-[0.14em] transition ${
                filter === f
                  ? "bubble-stroke-gradient text-bone"
                  : "border border-border text-bone-dim hover:text-bone"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={doSync}
          disabled={syncing}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full gradient-pill text-xs font-medium disabled:opacity-60"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>
      {note && <p className="px-5 pt-2 text-[11px] font-mono text-bone-dim">{note}</p>}

      <ul className="px-4 py-3 space-y-2">
        {visible.length === 0 && (
          <li className="text-xs text-bone-dim font-mono py-8 text-center">Nothing in {filter}.</li>
        )}
        {visible.map((r) => {
          const who = r.from_name || r.from_addr || "(unknown)";
          const unread = !r.seen;
          return (
            <li key={r.id}>
              <button
                onClick={() => setOpen(r)}
                className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-surface/40 hover:bg-surface transition-colors"
              >
                <div className="mt-1.5 shrink-0">
                  {r.importance === "high" ? (
                    <AlertCircle size={14} className="text-warmred" />
                  ) : unread ? (
                    <span className="block w-2 h-2 rounded-full bg-periwinkle" />
                  ) : (
                    <span className="block w-2 h-2 rounded-full bg-transparent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate ${unread ? "font-semibold text-bone" : "text-bone-dim"}`}>
                      {who}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] font-mono text-bone-mute">
                      {fmtDate(r.date)}
                    </span>
                  </div>
                  <div className={`truncate text-[14px] ${unread ? "text-bone" : "text-bone-dim"}`}>
                    {r.subject || "(no subject)"}
                  </div>
                  {r.summary && (
                    <div className="truncate text-[12px] text-bone-mute mt-0.5">{r.summary}</div>
                  )}
                  {multiBox && (
                    <div className="text-[10px] font-mono text-bone-mute mt-0.5">{r.mailbox}</div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {open && <DetailSheet email={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function DetailSheet({ email, onClose }: { email: EmailRow; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);
  const [moving, setMoving] = useState(false);
  const [folder, setFolder] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const act = (fn: () => Promise<{ msg?: string }>, closeAfter = true) =>
    startTransition(async () => {
      const r = await fn();
      if (r.msg) setMsg(r.msg);
      if (closeAfter) setTimeout(onClose, 350);
    });

  const who = email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr || "(unknown)";

  return (
    <Sheet title={email.mailbox} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <div className="text-[13px] text-bone-dim truncate">{who}</div>
          <h2 className="text-[17px] font-semibold text-bone leading-snug mt-0.5">
            {email.subject || "(no subject)"}
          </h2>
          <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-bone-mute">
            {email.importance === "high" && <span className="text-warmred uppercase">important</span>}
            {email.reason && <span>· {email.reason}</span>}
            {!email.seen && <span>· unread</span>}
          </div>
        </div>

        {email.summary && (
          <p className="text-[14px] text-bone bg-surface/50 border border-border rounded-lg px-3 py-2">
            {email.summary}
          </p>
        )}
        {email.snippet && (
          <p className="text-[13px] text-bone-dim leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
            {email.snippet}
          </p>
        )}

        {moving && (
          <Field label="Move to folder">
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. Receipts"
              autoFocus
              className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle focus:ring-1 focus:ring-periwinkle"
            />
          </Field>
        )}

        {msg && <p className="text-[12px] font-mono text-periwinkle">{msg}</p>}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <ActionBtn
            icon={BellPlus}
            label="Remind to reply"
            disabled={pending}
            onClick={() => act(() => remindAboutEmail(email.id), false)}
          />
          {!email.seen && (
            <ActionBtn icon={MailOpen} label="Mark read" disabled={pending} onClick={() => act(() => markRead(email.id))} />
          )}
          <ActionBtn icon={Archive} label="Archive" disabled={pending} onClick={() => act(() => archive(email.id))} />
          {moving ? (
            <ActionBtn
              icon={FolderInput}
              label={pending ? "Moving…" : "Confirm move"}
              disabled={pending || !folder.trim()}
              onClick={() => act(() => move(email.id, folder.trim()))}
            />
          ) : (
            <ActionBtn icon={FolderInput} label="Move…" disabled={pending} onClick={() => setMoving(true)} />
          )}
          <ActionBtn
            icon={Trash2}
            label={confirmDel ? "Tap to confirm" : "Delete"}
            danger
            disabled={pending}
            onClick={() => (confirmDel ? act(() => remove(email.id)) : setConfirmDel(true))}
          />
        </div>
      </div>
    </Sheet>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-medium transition disabled:opacity-50 ${
        danger
          ? "border-warmred/30 text-warmred hover:bg-warmred/10"
          : "border-border text-bone-dim hover:text-bone hover:bg-surface"
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}
