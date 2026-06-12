// Document understanding. Lets Nillad actually READ files — a PDF contract, a Word
// spec sheet, a plain-text bid, a photographed bill — instead of ignoring them.
// We extract the full text once (PDF via pdf-parse, .docx via mammoth, text/* as-is,
// images via the local vision model's OCR), store it, generate a one-line gist, and
// expose it to the chat `documents` tool + universal search. So "drop in a contract
// → what are the payment terms?" works. Everything stays local.

import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { getDb } from "@/lib/db";

const OLLAMA = process.env.OLLAMA_BASE_URL || "http://host.docker.internal:11434";
const MODEL = process.env.NILLAD_OLLAMA_MODEL || "gemma4:12b-it-qat";

const MAX_TEXT = 200_000; // cap stored text (~200k chars) so a giant PDF can't bloat the DB

export type DocKind = "pdf" | "docx" | "text" | "image" | "other";

export type Extracted = { text: string; pages: number; kind: DocKind };

function kindFor(filename: string, mime: string): DocKind {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (ext === "pdf" || m.includes("pdf")) return "pdf";
  if (ext === "docx" || m.includes("officedocument.wordprocessing")) return "docx";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic"].includes(ext) || m.startsWith("image/"))
    return "image";
  if (
    ["txt", "md", "markdown", "csv", "tsv", "json", "log", "html", "htm", "xml", "yaml", "yml", "rtf"].includes(
      ext,
    ) ||
    m.startsWith("text/") ||
    m.includes("json") ||
    m.includes("csv")
  )
    return "text";
  return "other";
}

// OCR an image by asking the local multimodal model to transcribe it. Quality is
// modest (it's a 12B), but it turns a photographed bill into searchable text.
async function ocrImage(buf: Buffer): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: false,
        options: { temperature: 0 },
        messages: [
          {
            role: "system",
            content:
              "You transcribe documents from images. Output ONLY the text you can read, preserving line breaks and numbers as faithfully as possible. No commentary.",
          },
          { role: "user", content: "Transcribe all text in this document.", images: [buf.toString("base64")] },
        ],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return "";
    const j = (await res.json()) as { message?: { content?: string } };
    return (j.message?.content || "").trim();
  } catch {
    return "";
  }
}

// Strip basic HTML to readable text (for .html uploads / html email parts).
function htmlToText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n");
}

// Extract text from a file buffer based on its type. Never throws — returns empty
// text (with the detected kind) if a parser fails, so ingestion always proceeds.
export async function extractText(buf: Buffer, filename: string, mime = ""): Promise<Extracted> {
  const kind = kindFor(filename, mime);
  try {
    if (kind === "pdf") {
      const parser = new PDFParse({ data: buf });
      try {
        const r = await parser.getText();
        return { text: (r.text || "").slice(0, MAX_TEXT), pages: r.total || 0, kind };
      } finally {
        await parser.destroy().catch(() => {});
      }
    }
    if (kind === "docx") {
      const r = await mammoth.extractRawText({ buffer: buf });
      return { text: (r.value || "").slice(0, MAX_TEXT), pages: 0, kind };
    }
    if (kind === "image") {
      const text = await ocrImage(buf);
      return { text: text.slice(0, MAX_TEXT), pages: 0, kind };
    }
    // text-ish / other → decode as UTF-8, de-HTML if it looks like markup.
    let text = buf.toString("utf8");
    if (/<\/?[a-z][\s\S]*>/i.test(text.slice(0, 2000)) && /\.html?$/i.test(filename)) text = htmlToText(text);
    return { text: text.slice(0, MAX_TEXT), pages: 0, kind: kind === "other" ? "text" : kind };
  } catch {
    return { text: "", pages: 0, kind };
  }
}

// One-line gist of a document via the local model (best-effort; empty on failure).
export async function summarize(filename: string, text: string): Promise<string> {
  const body = text.trim();
  if (!body) return "";
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          {
            role: "system",
            content:
              "Summarize what this document IS in ONE short factual line (e.g. 'Painting contract for 123 Main St — $4,200, net-30'). No preamble.",
          },
          { role: "user", content: `Filename: ${filename}\n\n${body.slice(0, 6000)}` },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return "";
    const j = (await res.json()) as { message?: { content?: string } };
    return (j.message?.content || "").replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
}

export type DocRow = {
  id: number;
  filename: string;
  mime: string | null;
  kind: string | null;
  bytes: number | null;
  pages: number | null;
  text: string | null;
  summary: string | null;
  source: string;
  email_id: number | null;
  job_id: number | null;
  created_at: string;
};

export type SaveDocInput = {
  filename: string;
  mime?: string;
  bytes?: number;
  text: string;
  pages?: number;
  kind?: DocKind;
  summary?: string;
  source?: "upload" | "email";
  emailId?: number;
  jobId?: number;
};

export function saveDocument(input: SaveDocInput): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO documents (filename, mime, kind, bytes, pages, text, summary, source, email_id, job_id)
       VALUES (@filename, @mime, @kind, @bytes, @pages, @text, @summary, @source, @email_id, @job_id)`,
    )
    .run({
      filename: input.filename,
      mime: input.mime || null,
      kind: input.kind || null,
      bytes: input.bytes ?? null,
      pages: input.pages ?? null,
      text: input.text || null,
      summary: input.summary || null,
      source: input.source || "upload",
      email_id: input.emailId ?? null,
      job_id: input.jobId ?? null,
    });
  return Number(info.lastInsertRowid);
}

// Full pipeline for an uploaded/attached buffer: extract → summarize → store.
export async function ingestDocument(
  buf: Buffer,
  filename: string,
  mime = "",
  opts: { source?: "upload" | "email"; emailId?: number; jobId?: number } = {},
): Promise<{ id: number; chars: number; pages: number; kind: DocKind; summary: string }> {
  const { text, pages, kind } = await extractText(buf, filename, mime);
  const summary = await summarize(filename, text);
  const id = saveDocument({
    filename,
    mime,
    bytes: buf.length,
    text,
    pages,
    kind,
    summary,
    source: opts.source || "upload",
    emailId: opts.emailId,
    jobId: opts.jobId,
  });
  return { id, chars: text.length, pages, kind, summary };
}

// ---------- Reads for the chat tool ----------

export function listDocuments(limit = 25): DocRow[] {
  return getDb()
    .prepare(
      `SELECT id, filename, mime, kind, bytes, pages, summary, source, email_id, job_id, created_at
       FROM documents ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(limit) as DocRow[];
}

export function getDocument(id: number): DocRow | undefined {
  return getDb().prepare(`SELECT * FROM documents WHERE id=?`).get(id) as DocRow | undefined;
}

export function deleteDocument(id: number): void {
  getDb().prepare(`DELETE FROM documents WHERE id=?`).run(id);
}
