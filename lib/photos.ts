// Gallery storage. Photo FILES live in the vault under Photos/ (so they also show
// in Obsidian and are part of the same $0 local-first store); metadata (caption,
// tags) lives in the `photos` table keyed by filename. All path handling is
// confined to PHOTOS_DIR — no traversal out of it.

import fs from "node:fs";
import path from "node:path";
import { VAULT_ROOT } from "@/lib/vault";

export const PHOTOS_DIR = path.join(VAULT_ROOT, "Photos");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function ensureDir(): void {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// Sanitize to a bare filename inside PHOTOS_DIR (strip any path), then verify the
// resolved path is still inside PHOTOS_DIR. Returns null on anything fishy.
export function safePhotoPath(name: string): string | null {
  if (!name) return null;
  const base = path.basename(name.replace(/\\/g, "/"));
  if (!base || base.startsWith(".")) return null;
  const abs = path.resolve(PHOTOS_DIR, base);
  if (abs !== path.resolve(PHOTOS_DIR, base) || path.dirname(abs) !== path.resolve(PHOTOS_DIR)) {
    return null;
  }
  return abs;
}

export type PhotoFile = { name: string; mtime: number; size: number };

export function listPhotoFiles(): PhotoFile[] {
  try {
    ensureDir();
    const out: PhotoFile[] = [];
    for (const e of fs.readdirSync(PHOTOS_DIR, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (!IMAGE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = fs.statSync(path.join(PHOTOS_DIR, e.name));
        out.push({ name: e.name, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* skip unreadable */
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch {
    return [];
  }
}

// Decode a data URL ("data:image/jpeg;base64,…") and write it. If `name` is taken
// and overwrite is false, a numeric suffix is added. Returns the final filename.
export function savePhotoDataUrl(name: string, dataUrl: string, overwrite = false): string {
  ensureDir();
  const m = /^data:(image\/(jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("Unsupported image data.");
  const ext = m[2] === "jpeg" ? ".jpg" : `.${m[2]}`;
  const buf = Buffer.from(m[3], "base64");

  let base = path.basename(name.replace(/\\/g, "/")).replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!IMAGE_EXT.has(path.extname(base).toLowerCase())) base = base.replace(/\.[^.]*$/, "") + ext;
  if (!base || base.startsWith(".")) base = `photo${ext}`;

  let target = path.join(PHOTOS_DIR, base);
  if (!overwrite) {
    let i = 1;
    const stem = base.replace(/\.[^.]*$/, "");
    const e = path.extname(base);
    while (fs.existsSync(target)) {
      target = path.join(PHOTOS_DIR, `${stem}-${i}${e}`);
      i++;
    }
  }
  fs.writeFileSync(target, buf);
  return path.basename(target);
}

export function deletePhotoFile(name: string): boolean {
  const abs = safePhotoPath(name);
  if (!abs || !fs.existsSync(abs)) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

export function readPhoto(name: string): { buf: Buffer; type: string } | null {
  const abs = safePhotoPath(name);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    return { buf: fs.readFileSync(abs), type: CONTENT_TYPE[path.extname(abs).toLowerCase()] || "application/octet-stream" };
  } catch {
    return null;
  }
}
