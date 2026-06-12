"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ImageIcon,
  Upload,
  X,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  Pencil,
  Download,
  Loader2,
  Check,
} from "lucide-react";
import { deletePhoto, updatePhotoMeta } from "./actions";

export type Photo = { name: string; caption: string; tags: string };

// Downscale a picked file to a sane size + JPEG so uploads stay small and the
// store doesn't fill with 12MP originals.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function fileToDataUrl(file: File, maxDim = 2400, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function GalleryShell({ photos }: { photos: Photo[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0); // cache-buster bumped after edits
  const [open, setOpen] = useState<Photo | null>(null);

  const src = (name: string) => `/api/photo?name=${encodeURIComponent(name)}&v=${rev}`;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      for (const f of files) {
        const dataUrl = await fileToDataUrl(f);
        await fetch("/api/photo/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: f.name, dataUrl }),
        });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPick} />

      {photos.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-surface border border-border flex items-center justify-center mb-3">
            <ImageIcon size={20} className="text-bone-dim" />
          </div>
          <div className="text-sm font-medium text-bone">No photos yet</div>
          <p className="text-xs text-bone-dim mt-1 max-w-[30ch] mx-auto">
            Tap + to add photos. They’re stored in your vault’s Photos folder.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1 px-1 pt-1">
          {photos.map((p) => (
            <button
              key={p.name}
              onClick={() => setOpen(p)}
              className="relative aspect-square overflow-hidden rounded-md bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(p.name)} alt={p.caption || p.name} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label="Add photos"
        className="fixed right-5 bottom-24 w-14 h-14 rounded-full grid place-items-center z-10 shadow-lg disabled:opacity-70"
        style={{
          background: "linear-gradient(65deg, #625CC8 0%, #D52F31 100%)",
          boxShadow: "0 8px 24px rgba(98,92,200,0.35)",
        }}
      >
        {busy ? <Loader2 size={22} className="text-bone animate-spin" /> : <Upload size={22} className="text-bone" />}
      </button>

      {open && (
        <Viewer
          photo={open}
          srcUrl={src(open.name)}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setRev((r) => r + 1);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

type Adjust = {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  aspect: "free" | "1:1" | "4:3" | "16:9";
};
const DEFAULT_ADJ: Adjust = {
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  aspect: "free",
};

function Viewer({
  photo,
  srcUrl,
  onClose,
  onChanged,
}: {
  photo: Photo;
  srcUrl: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "info">("view");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [caption, setCaption] = useState(photo.caption);
  const [tags, setTags] = useState(photo.tags);

  async function doDelete() {
    setBusy(true);
    await deletePhoto(photo.name);
    onChanged();
    onClose();
  }
  async function saveMeta() {
    setBusy(true);
    await updatePhotoMeta(photo.name, caption, tags);
    setBusy(false);
    setMode("view");
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 grid place-items-center rounded-full text-bone-dim hover:text-bone">
          <X size={20} />
        </button>
        <span className="text-xs font-mono text-bone-mute truncate max-w-[55%]">{photo.name}</span>
        <a
          href={srcUrl}
          download={photo.name}
          aria-label="Download"
          className="w-10 h-10 grid place-items-center rounded-full text-bone-dim hover:text-bone"
        >
          <Download size={18} />
        </a>
      </div>

      {mode === "edit" ? (
        <Editor photo={photo} srcUrl={srcUrl} onCancel={() => setMode("view")} onSaved={() => { setMode("view"); onChanged(); }} />
      ) : (
        <>
          <div className="flex-1 min-h-0 flex items-center justify-center px-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={srcUrl} alt={photo.caption || photo.name} className="max-w-full max-h-full object-contain" />
          </div>

          {mode === "info" ? (
            <div className="shrink-0 p-4 space-y-3 bg-bg border-t border-border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">Caption</span>
                <input value={caption} onChange={(e) => setCaption(e.target.value)} className="mt-1 w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone outline-none focus:border-periwinkle" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-bone-mute font-mono">Tags (comma-sep)</span>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="job, before, kitchen" className="mt-1 w-full rounded-lg bg-surface border border-border px-3 py-2 text-bone placeholder:text-bone-mute outline-none focus:border-periwinkle" />
              </label>
              <div className="flex justify-end gap-3">
                <button onClick={() => setMode("view")} className="text-bone-dim text-sm">Cancel</button>
                <button onClick={saveMeta} disabled={busy} className="gradient-pill px-5 py-2 text-sm font-medium">{busy ? "Saving…" : "Save"}</button>
              </div>
            </div>
          ) : (
            <div className="shrink-0 grid grid-cols-3 gap-2 p-3 bg-bg border-t border-border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
              <ToolBtn icon={Pencil} label="Edit" onClick={() => setMode("edit")} />
              <ToolBtn icon={ImageIcon} label={photo.caption || photo.tags ? "Details" : "Add info"} onClick={() => setMode("info")} />
              <ToolBtn icon={Trash2} label={confirmDel ? "Confirm?" : "Delete"} danger disabled={busy} onClick={() => (confirmDel ? doDelete() : setConfirmDel(true))} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ToolBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 py-2 rounded-xl border transition disabled:opacity-50 ${
        danger ? "border-warmred/30 text-warmred" : "border-border text-bone-dim hover:text-bone"
      }`}
    >
      <Icon size={18} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

const ASPECTS: Record<Adjust["aspect"], number | null> = { free: null, "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9 };

function Editor({
  photo,
  srcUrl,
  onCancel,
  onSaved,
}: {
  photo: Photo;
  srcUrl: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [adj, setAdj] = useState<Adjust>(DEFAULT_ADJ);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load the source image once.
  useEffect(() => {
    let alive = true;
    loadImage(srcUrl).then((img) => {
      if (!alive) return;
      imgRef.current = img;
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [srcUrl]);

  // Re-render the canvas whenever an adjustment changes.
  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!ready || !img || !canvas) return;

    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    const ar = ASPECTS[adj.aspect];
    if (ar) {
      const srcRatio = sw / sh;
      if (srcRatio > ar) {
        const newW = sh * ar;
        sx = (sw - newW) / 2;
        sw = newW;
      } else {
        const newH = sw / ar;
        sy = (sh - newH) / 2;
        sh = newH;
      }
    }
    const rot = ((adj.rotation % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    canvas.width = swap ? sh : sw;
    canvas.height = swap ? sw : sh;
    const ctx = canvas.getContext("2d")!;
    ctx.filter = `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturation})`;
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(adj.flipH ? -1 : 1, adj.flipV ? -1 : 1);
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }, [adj, ready]);

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      await fetch("/api/photo/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: photo.name, dataUrl, overwrite: true }),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const rotate = (d: number) => setAdj((a) => ({ ...a, rotation: a.rotation + d }));
  const slider = (k: "brightness" | "contrast" | "saturation", v: number) =>
    setAdj((a) => ({ ...a, [k]: v }));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex items-center justify-center px-2">
        {!ready ? (
          <Loader2 className="animate-spin text-bone-mute" />
        ) : (
          <canvas ref={canvasRef} className="max-w-full max-h-full object-contain" />
        )}
      </div>

      <div className="shrink-0 bg-bg border-t border-border p-3 space-y-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <div className="flex items-center justify-center gap-2">
          <IconChip icon={RotateCcw} onClick={() => rotate(-90)} />
          <IconChip icon={RotateCw} onClick={() => rotate(90)} />
          <IconChip icon={FlipHorizontal} active={adj.flipH} onClick={() => setAdj((a) => ({ ...a, flipH: !a.flipH }))} />
          <IconChip icon={FlipVertical} active={adj.flipV} onClick={() => setAdj((a) => ({ ...a, flipV: !a.flipV }))} />
        </div>

        <div className="flex items-center gap-1.5 justify-center">
          {(Object.keys(ASPECTS) as Adjust["aspect"][]).map((k) => (
            <button
              key={k}
              onClick={() => setAdj((a) => ({ ...a, aspect: k }))}
              className={`px-2.5 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider transition ${
                adj.aspect === k ? "bubble-stroke-gradient text-bone" : "border border-border text-bone-dim"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <Slide label="Brightness" value={adj.brightness} onChange={(v) => slider("brightness", v)} />
        <Slide label="Contrast" value={adj.contrast} onChange={(v) => slider("contrast", v)} />
        <Slide label="Saturation" value={adj.saturation} min={0} max={2} onChange={(v) => slider("saturation", v)} />

        <div className="flex items-center justify-between pt-1">
          <button onClick={() => setAdj(DEFAULT_ADJ)} className="text-bone-dim text-sm">Reset</button>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="text-bone-dim text-sm">Cancel</button>
            <button onClick={save} disabled={busy || !ready} className="inline-flex items-center gap-1.5 gradient-pill px-5 py-2 text-sm font-medium disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconChip({ icon: Icon, onClick, active }: { icon: typeof RotateCw; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 grid place-items-center rounded-full border transition ${
        active ? "bubble-stroke-gradient text-bone" : "border-border text-bone-dim hover:text-bone"
      }`}
    >
      <Icon size={17} />
    </button>
  );
}

function Slide({
  label,
  value,
  onChange,
  min = 0.5,
  max = 1.5,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-20 text-[11px] uppercase tracking-wider text-bone-mute font-mono">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-periwinkle"
      />
    </label>
  );
}
