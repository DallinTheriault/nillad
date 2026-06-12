"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  FileType,
  Image as ImageIcon,
  File,
  Trash2,
  Loader2,
  Mail,
} from "lucide-react";
import { Sheet } from "@/components/sheet";
import { getDocText, removeDoc } from "./actions";

export type DocMeta = {
  id: number;
  filename: string;
  kind: string | null;
  bytes: number | null;
  pages: number | null;
  summary: string | null;
  source: string;
  created_at: string;
  has_text: number;
};

function kindIcon(kind: string | null) {
  switch (kind) {
    case "pdf":
      return FileText;
    case "docx":
      return FileType;
    case "image":
      return ImageIcon;
    default:
      return File;
  }
}

function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes("T") || iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DocumentsShell({ rows }: { rows: DocMeta[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<DocMeta | null>(null);
  const [docText, setDocText] = useState<string>("");
  const [loadingText, setLoadingText] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setUploadMsg(null);
    let ok = 0;
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok && data.ok) ok++;
        else setUploadMsg(data.error || "Upload failed.");
      } catch {
        setUploadMsg("Upload failed.");
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (ok) {
      setUploadMsg(`Read ${ok} document${ok > 1 ? "s" : ""}.`);
      router.refresh();
    }
  }

  async function openDoc(d: DocMeta) {
    setOpen(d);
    setDocText("");
    if (d.has_text) {
      setLoadingText(true);
      const t = await getDocText(d.id);
      setDocText(t);
      setLoadingText(false);
    }
  }

  function onDelete(id: number) {
    if (!confirm("Delete this document? Nillad will no longer be able to read it.")) return;
    startTransition(async () => {
      await removeDoc(id);
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <div className="px-3">
      {/* Upload */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.csv,.json,.log,.html,.rtf,image/*"
        onChange={onPick}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong bg-surface py-4 text-[15px] text-bone-dim hover:border-periwinkle/60 hover:text-bone transition-colors disabled:opacity-60"
      >
        {uploading ? <Loader2 size={18} className="animate-spin text-periwinkle" /> : <Upload size={18} />}
        {uploading ? "Reading…" : "Upload a document"}
      </button>
      {uploadMsg ? <p className="mt-2 text-center text-[12.5px] text-bone-mute">{uploadMsg}</p> : null}
      <p className="mt-1.5 text-center text-[11.5px] text-bone-mute">
        PDF, Word, text, or a photo. Nillad reads it — then ask about it in chat.
      </p>

      {/* List */}
      {rows.length === 0 ? (
        <p className="mt-10 text-center text-sm text-bone-mute">
          No documents yet. Upload a contract, bid, or bill and ask Nillad about it.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((d) => {
            const Icon = kindIcon(d.kind);
            return (
              <button
                key={d.id}
                onClick={() => openDoc(d)}
                className="flex w-full items-start gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 text-left hover:bg-surface-2 transition-colors"
              >
                <Icon size={20} className="mt-0.5 shrink-0 text-periwinkle-soft" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-bone">{d.filename}</span>
                    {d.source === "email" ? <Mail size={12} className="shrink-0 text-bone-mute" /> : null}
                  </div>
                  {d.summary ? (
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-bone-dim">{d.summary}</p>
                  ) : !d.has_text ? (
                    <p className="mt-0.5 text-[12px] italic text-bone-mute">No readable text extracted.</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-bone-mute">
                    {[d.kind, d.pages ? `${d.pages}p` : "", fmtBytes(d.bytes), fmtDate(d.created_at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail */}
      {open ? (
        <Sheet title="Document" onClose={() => setOpen(null)}>
          <div className="min-w-0">
            <h2 className="break-words text-[17px] font-semibold text-bone">{open.filename}</h2>
            {open.summary ? <p className="mt-1 text-[13px] text-bone-dim">{open.summary}</p> : null}
          </div>

          <div className="mt-3 max-h-[55vh] overflow-y-auto rounded-xl border border-border bg-bg p-3">
            {loadingText ? (
              <div className="flex items-center gap-2 text-sm text-bone-mute">
                <Loader2 size={15} className="animate-spin" /> Loading text…
              </div>
            ) : docText ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-bone-dim">
                {docText}
              </pre>
            ) : (
              <p className="text-sm italic text-bone-mute">
                No extractable text (it may be a scan or image with unreadable content).
              </p>
            )}
          </div>

          <button
            onClick={() => onDelete(open.id)}
            disabled={pending}
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-red-dim/50 bg-red/10 py-2.5 text-[14px] text-red-soft hover:bg-red/20 transition-colors disabled:opacity-60"
          >
            <Trash2 size={16} /> Delete document
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
