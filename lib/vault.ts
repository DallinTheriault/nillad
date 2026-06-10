// Read/write access to Dallin's Obsidian "Axiom" vault (the markdown knowledge
// base mounted at /vault, alongside nillad.db). This is what lets Nillad actually
// SEE his notes — search them, read one, and append durable notes back. Plain
// filesystem + keyword search (no embeddings): cheap, and plenty for a 12B over a
// vault of this size. Writes are confined to the vault root (no path traversal).

import fs from "node:fs";
import path from "node:path";

// Vault root = where nillad.db lives (/vault in the container). Overridable.
export const VAULT_ROOT =
  process.env.NILLAD_VAULT ||
  (process.env.NILLAD_DB ? path.dirname(process.env.NILLAD_DB) : "/vault");

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", "logs"]);
const MAX_FILE_BYTES = 1_000_000;
const READ_CAP = 8000; // chars returned for a single note
const SNIPPET_CAP = 240;

type Note = { rel: string; abs: string; mtime: number };

function walk(dir: string, out: Note[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      const abs = path.join(dir, e.name);
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        /* ignore */
      }
      const rel = path.relative(VAULT_ROOT, abs).replace(/\\/g, "/");
      out.push({ rel, abs, mtime });
    }
  }
}

function allNotes(): Note[] {
  const out: Note[] = [];
  walk(VAULT_ROOT, out);
  return out;
}

// Resolve a user/model-supplied note path to an absolute path INSIDE the vault.
// Returns null on traversal attempts. Appends .md if missing.
function safeResolve(rel: string): string | null {
  if (!rel) return null;
  let r = rel.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!/\.md$/i.test(r)) r += ".md";
  const rootAbs = path.resolve(VAULT_ROOT);
  const abs = path.resolve(rootAbs, r);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

const words = (q: string): string[] => q.toLowerCase().match(/[a-z0-9]{3,}/g) || [];

export function listNotes(folder?: string): string {
  let notes = allNotes();
  if (folder) {
    const f = folder.toLowerCase();
    notes = notes.filter((n) => n.rel.toLowerCase().includes(f));
  }
  if (!notes.length) return folder ? `No notes under "${folder}".` : "Vault has no notes yet.";
  notes.sort((a, b) => a.rel.localeCompare(b.rel));
  return `${notes.length} note(s):\n` + notes.map((n) => `- ${n.rel}`).join("\n");
}

export function searchNotes(query: string, limit = 6): string {
  const terms = words(query);
  const notes = allNotes();
  if (!notes.length) return "Vault has no notes yet.";
  if (!terms.length) {
    notes.sort((a, b) => b.mtime - a.mtime);
    return (
      "No search terms — most recently edited notes:\n" +
      notes.slice(0, limit).map((n) => `- ${n.rel}`).join("\n")
    );
  }

  type Hit = { rel: string; score: number; mtime: number; snippet: string };
  const hits: Hit[] = [];
  for (const n of notes) {
    let content: string;
    try {
      if (fs.statSync(n.abs).size > MAX_FILE_BYTES) continue;
      content = fs.readFileSync(n.abs, "utf8");
    } catch {
      continue;
    }
    const lowContent = content.toLowerCase();
    const lowRel = n.rel.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lowRel.includes(t)) score += 3; // filename match weighs more
      if (lowContent.includes(t)) score += 1;
    }
    if (score === 0) continue;
    // snippet: first line that contains any term
    let snippet = "";
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const low = line.toLowerCase();
      if (terms.some((t) => low.includes(t)) && line.trim()) {
        snippet = line.trim().slice(0, SNIPPET_CAP);
        break;
      }
    }
    if (!snippet) {
      const firstReal = lines.find((l) => l.trim());
      snippet = (firstReal || "").trim().slice(0, SNIPPET_CAP);
    }
    hits.push({ rel: n.rel, score, mtime: n.mtime, snippet });
  }
  if (!hits.length) return `No notes match "${query}". (Try different words, or list a folder.)`;
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits
    .slice(0, limit)
    .map((h) => `• ${h.rel}\n   ${h.snippet}`)
    .join("\n");
}

export function readNote(pathOrName: string): string {
  if (!pathOrName) return "Error: read needs a note `path` (e.g. 'Projects/Field.md').";
  // exact path first
  const exact = safeResolve(pathOrName);
  if (exact && fs.existsSync(exact)) {
    try {
      const text = fs.readFileSync(exact, "utf8");
      const rel = path.relative(VAULT_ROOT, exact).replace(/\\/g, "/");
      return `${rel}:\n${text.length > READ_CAP ? text.slice(0, READ_CAP) + "\n…(truncated)" : text}`;
    } catch (e) {
      return `Couldn't read ${pathOrName}: ${e instanceof Error ? e.message : e}`;
    }
  }
  // fuzzy by basename / path contains
  const q = pathOrName.toLowerCase().replace(/\.md$/i, "");
  const candidates = allNotes().filter(
    (n) => n.rel.toLowerCase().includes(q) || path.basename(n.rel).toLowerCase().includes(q),
  );
  if (candidates.length === 1) {
    try {
      const text = fs.readFileSync(candidates[0].abs, "utf8");
      return `${candidates[0].rel}:\n${text.length > READ_CAP ? text.slice(0, READ_CAP) + "\n…(truncated)" : text}`;
    } catch (e) {
      return `Couldn't read ${candidates[0].rel}: ${e instanceof Error ? e.message : e}`;
    }
  }
  if (candidates.length > 1) {
    return (
      `Multiple notes match "${pathOrName}" — read one by its path:\n` +
      candidates.slice(0, 10).map((n) => `- ${n.rel}`).join("\n")
    );
  }
  return `No note found for "${pathOrName}". Use vault(search) to find it, or vault(list) to browse.`;
}

export function appendNote(notePath: string, text: string): string {
  if (!notePath) return "Error: append needs a note `path` (e.g. 'Memory/Audi S6.md').";
  if (!text) return "Error: append needs `text` to write.";
  const abs = safeResolve(notePath);
  if (!abs) return `Error: "${notePath}" is outside the vault.`;
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existed = fs.existsSync(abs);
    const body = existed ? `\n\n${text.trim()}\n` : `${text.trim()}\n`;
    fs.appendFileSync(abs, body, "utf8");
    const rel = path.relative(VAULT_ROOT, abs).replace(/\\/g, "/");
    return existed ? `Appended to ${rel}.` : `Created ${rel}.`;
  } catch (e) {
    return `Couldn't write ${notePath}: ${e instanceof Error ? e.message : e}`;
  }
}
