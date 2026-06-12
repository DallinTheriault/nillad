"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Memory graph: a dense, shimmering 3D point-cloud you can fling on both axes.
// Modeled after a knowledge-graph (Obsidian / 3D force graph) but in Nillad
// colors only (periwinkle + red). Volumetric distribution + many short edges =
// complex organic web; per-node colour flash + gloss = alive. Labels cycle
// convo sparks + recent activities; tap one to start that chat.

const N = 260;
const NEIGHBORS = 3;
const EDGE_CAP2 = 0.2; // skip edges longer than ~0.45 (keeps local clustering)
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const COLORS: [number, number, number][] = [
  [0x62, 0x5c, 0xc8], // peri
  [0x7e, 0x78, 0xd6], // peri soft
  [0xd5, 0x2f, 0x31], // red
  [0xe8, 0x59, 0x5b], // red soft
  [0x4a, 0x45, 0x9e], // dim peri (depth filler)
];
const lighten = (c: [number, number, number]) =>
  c.map((v) => Math.round(v + (255 - v) * 0.55)) as unknown as [number, number, number];

function hash(i: number): number {
  const v = Math.sin(i * 127.1 + 0.5) * 43758.5453;
  return v - Math.floor(v);
}

type Node = {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  hr: number;
  hg: number;
  hb: number;
  size: number;
  phase: number;
};

// Volumetric ball: fibonacci direction + jittered radius + organic noise so it
// fills the volume (depth) instead of a clean shell.
const NODES: Node[] = Array.from({ length: N }, (_, i) => {
  const y0 = 1 - (i / (N - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y0 * y0));
  const theta = i * GOLDEN;
  const rad = 0.42 + 0.58 * Math.sqrt(hash(i * 1.7)); // bias outward, fill inside
  let x = Math.cos(theta) * ring * rad;
  let y = y0 * rad;
  let z = Math.sin(theta) * ring * rad;
  x += (hash(i * 3.1) - 0.5) * 0.14;
  y += (hash(i * 5.3) - 0.5) * 0.14;
  z += (hash(i * 7.9) - 0.5) * 0.14;
  const h = hash(i * 7.7);
  const ci = h < 0.34 ? 0 : h < 0.5 ? 1 : h < 0.78 ? 2 : h < 0.9 ? 3 : 4;
  const base = COLORS[ci];
  const hi = lighten(base);
  const hub = hash(i * 9.1) > 0.9; // ~10% bigger "hub" nodes for variety
  return {
    x,
    y,
    z,
    r: base[0],
    g: base[1],
    b: base[2],
    hr: hi[0],
    hg: hi[1],
    hb: hi[2],
    size: (hub ? 1.9 : 0.5) + 0.9 * hash(i * 5.1),
    phase: hash(i * 2.1) * Math.PI * 2,
  };
});

const EDGES: [number, number][] = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const ds = NODES.map((n, j) => {
      const dx = NODES[i].x - n.x;
      const dy = NODES[i].y - n.y;
      const dz = NODES[i].z - n.z;
      return [j, dx * dx + dy * dy + dz * dz] as [number, number];
    })
      .filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1]);
    let added = 0;
    for (let k = 0; k < ds.length && added < NEIGHBORS; k++) {
      if (ds[k][1] > EDGE_CAP2) break;
      const j = ds[k][0];
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push([i, j]);
      }
      added++;
    }
  }
  return out;
})();

const SPARKS = [
  "How'd the car meet go?",
  "make more money machine",
  "the thing you keep putting off",
  "meeting with the president",
  "a recent project",
  "random shower thought",
  "what's the move today?",
  "did you ever call them back?",
  "faceless YouTube channel",
  "that downtown job",
  "new automation idea",
  "Dashboard build",
];

// Ideas ride on real nodes: pick a handful of well-separated nodes; each shows a
// label pinned to that node's projected position, so it drifts as the graph
// spins (the node "recommends" the idea) and fades out as it rotates to the back.
const LABEL_COUNT = 6;
const LABEL_NODES = Array.from({ length: LABEL_COUNT }, (_, k) =>
  Math.floor(((k + 0.5) / LABEL_COUNT) * N),
);

export function NilladGraph({ recent = [] }: { recent?: string[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rot = useRef({ x: -0.4, y: 0 });
  const vel = useRef({ x: 0, y: 0.0013 });
  const drag = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelText = useRef<string[]>([]);
  const router = useRouter();

  // Distinct idea per labelled node — never the same text on two nodes at once.
  const pool = [...recent.filter(Boolean), ...SPARKS];
  useEffect(() => {
    const shown = new Set<string>();
    const pickFresh = () => {
      const avail = pool.filter((t) => !shown.has(t));
      const choice = (avail.length ? avail : pool)[Math.floor(Math.random() * (avail.length ? avail.length : pool.length))] ?? "";
      return choice;
    };
    for (let k = 0; k < LABEL_COUNT; k++) {
      const t = pickFresh();
      shown.add(t);
      labelText.current[k] = t;
      const el = labelRefs.current[k];
      if (el) el.textContent = t;
    }
    // Cycle one label at a time so the cloud feels alive but stays readable.
    let k = 0;
    const id = setInterval(() => {
      const old = labelText.current[k];
      shown.delete(old);
      const t = pickFresh();
      shown.add(t);
      labelText.current[k] = t;
      const el = labelRefs.current[k];
      if (el) {
        el.style.transition = "opacity 0.4s";
        el.textContent = t;
      }
      k = (k + 1) % LABEL_COUNT;
    }, 3500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Robust sizing: a ResizeObserver fixes the desktop case where the layout
    // wasn't settled on mount (canvas was getting 0/tiny -> looked broken).
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width || wrap.clientWidth;
      if (w > 0) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(w * dpr);
      }
    });
    ro.observe(wrap);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    const render = () => {
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0) {
        raf = requestAnimationFrame(render);
        return;
      }
      const cx = W / 2;
      const cy = H / 2;
      const r = W * 0.54;
      t += 0.016;

      if (!drag.current) {
        rot.current.x += vel.current.x;
        rot.current.y += vel.current.y;
        const idleY = reduced ? 0 : 0.0013;
        vel.current.x *= 0.9;
        vel.current.y = vel.current.y * 0.9 + idleY * 0.1;
      }

      const cX = Math.cos(rot.current.x);
      const sX = Math.sin(rot.current.x);
      const cY = Math.cos(rot.current.y);
      const sY = Math.sin(rot.current.y);

      const P = NODES.map((n) => {
        const x1 = n.x * cY - n.z * sY;
        const z1 = n.x * sY + n.z * cY;
        const y2 = n.y * cX - z1 * sX;
        const z2 = n.y * sX + z1 * cX;
        const persp = 1 / (2.2 - z2);
        return { sx: cx + x1 * r * persp, sy: cy + y2 * r * persp, depth: z2, persp };
      });

      ctx.clearRect(0, 0, W, H);

      ctx.lineWidth = Math.max(0.5, dpr * 0.4);
      for (const [i, j] of EDGES) {
        const a = P[i];
        const b = P[j];
        const d = (a.depth + b.depth) / 2;
        const al = Math.max(0.02, 0.07 * ((d + 1) / 2));
        ctx.strokeStyle = `rgba(130, 134, 210, ${al})`;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      const order = NODES.map((_, i) => i).sort((a, b) => P[a].depth - P[b].depth);
      for (const i of order) {
        const p = P[i];
        const n = NODES[i];
        const da = Math.max(0.22, (p.depth + 1) / 2);
        const rad = Math.max(0.7, n.size * p.persp * dpr * 1.15);
        const sh = 0.5 + 0.5 * Math.sin(t * 0.5 + n.phase);
        const mr = (n.r + (n.hr - n.r) * sh * 0.75) | 0;
        const mg = (n.g + (n.hg - n.g) * sh * 0.75) | 0;
        const mb = (n.b + (n.hb - n.b) * sh * 0.75) | 0;
        ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, ${0.1 * da})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rad * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, ${da})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * sh * da})`;
        ctx.beginPath();
        ctx.arc(p.sx - rad * 0.3, p.sy - rad * 0.3, rad * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pin idea labels just above their host node; fade out as the node spins
      // to the back so labels drift in and out around the sphere.
      for (let k = 0; k < LABEL_NODES.length; k++) {
        const el = labelRefs.current[k];
        if (!el) continue;
        const lp = P[LABEL_NODES[k]];
        let o = (lp.depth + 1) / 2;
        o = Math.max(0, Math.min(1, (o - 0.4) / 0.45));
        el.style.transform = `translate(${lp.sx / dpr}px, ${lp.sy / dpr}px) translate(-50%, -120%)`;
        el.style.opacity = String(o * 0.95);
        el.style.pointerEvents = o > 0.25 ? "auto" : "none";
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  function onDown(e: React.PointerEvent) {
    drag.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const k = 0.018; // responsive 1:1 thumb tracking
    const dx = (e.clientX - last.current.x) * k;
    const dy = (e.clientY - last.current.y) * k;
    // Inverted control — the sphere rolls OPPOSITE the thumb (swipe up → top rolls
    // down/toward you), like spinning a globe from the far side.
    rot.current.y -= dx;
    rot.current.x -= dy;
    // smoothed + clamped throw so a quick wiggle can't fling it a quarter turn
    const clamp = (v: number) => Math.max(-0.04, Math.min(0.04, v));
    vel.current = {
      x: clamp(vel.current.x * 0.5 - dy * 0.5),
      y: clamp(vel.current.y * 0.5 - dx * 0.5),
    };
    last.current = { x: e.clientX, y: e.clientY };
  }
  function onUp() {
    drag.current = false;
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full aspect-square select-none cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {/* Node-tethered idea labels — positioned every frame by the render loop. */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: LABEL_COUNT }, (_, k) => (
          <button
            key={k}
            ref={(el) => {
              labelRefs.current[k] = el;
            }}
            onClick={(e) => {
              e.stopPropagation();
              const t = labelText.current[k];
              if (t) router.push(`/chat?q=${encodeURIComponent(t)}`);
            }}
            className="absolute top-0 left-0 will-change-transform text-[11px] italic font-medium text-bone whitespace-nowrap max-w-[44vw] truncate active:opacity-60"
            style={{ opacity: 0, textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}
          />
        ))}
      </div>
    </div>
  );
}
