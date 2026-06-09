// Procedurally generated low-poly SVG, periwinkle (bottom-left) -> red (top-right).
// Deterministic via seeded RNG so SSR matches client. Use as a CSS background
// or as a positioned <LowPolyBg /> element.

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h: string): [number, number, number] {
  const m = h.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}
function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mixColors(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex([lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t)]);
}

type Tri = { d: string; fill: string };

export function generateLowPoly({
  rows = 9,
  cols = 14,
  width = 1600,
  height = 1000,
  seed = 7,
  periwinkle = "#5E6CE8",
  red = "#E63E3E",
  darken = 0.0,
}: {
  rows?: number;
  cols?: number;
  width?: number;
  height?: number;
  seed?: number;
  periwinkle?: string;
  red?: string;
  /** 0 = palette as-is; 0.3 = blend toward bg for dimmer feel */
  darken?: number;
} = {}): Tri[] {
  const rand = mulberry32(seed);
  const cellW = width / cols;
  const cellH = height / rows;

  // Vertex grid with jitter for organic look
  const verts: [number, number][][] = [];
  for (let r = 0; r <= rows; r++) {
    verts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const jx = (rand() - 0.5) * cellW * 0.5;
      const jy = (rand() - 0.5) * cellH * 0.5;
      verts[r][c] = [c * cellW + jx, r * cellH + jy];
    }
  }

  const bg = "#0F0E18";
  const tris: Tri[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v00 = verts[r][c];
      const v01 = verts[r][c + 1];
      const v10 = verts[r + 1][c];
      const v11 = verts[r + 1][c + 1];
      // Vary diagonal direction per cell so it doesn't look like a grid
      const flip = (rand() < 0.5);
      const pairs = flip
        ? [
            [v00, v01, v10],
            [v01, v11, v10],
          ]
        : [
            [v00, v01, v11],
            [v00, v11, v10],
          ];
      for (const t of pairs) {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
        const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        // Periwinkle anchored bottom-left (0, height); red anchored top-right (width, 0)
        const xNorm = Math.max(0, Math.min(1, cx / width));
        const yNorm = Math.max(0, Math.min(1, 1 - cy / height));
        const mix = Math.max(0, Math.min(1, (xNorm + yNorm) / 2));
        // Slight per-triangle value jitter so adjacent faces read distinctly
        const jitter = (rand() - 0.5) * 0.08;
        const t_mix = Math.max(0, Math.min(1, mix + jitter));
        let color = mixColors(periwinkle, red, t_mix);
        if (darken > 0) color = mixColors(color, bg, darken);
        const d = `M${t[0][0]},${t[0][1]} L${t[1][0]},${t[1][1]} L${t[2][0]},${t[2][1]} Z`;
        tris.push({ d, fill: color });
      }
    }
  }
  return tris;
}

export function LowPolyBg({
  className = "",
  seed = 7,
  rows,
  cols,
  darken,
}: {
  className?: string;
  seed?: number;
  rows?: number;
  cols?: number;
  darken?: number;
}) {
  const tris = generateLowPoly({ seed, rows, cols, darken });
  return (
    <svg
      className={className}
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {tris.map((t, i) => (
        <path key={i} d={t.d} fill={t.fill} />
      ))}
    </svg>
  );
}
