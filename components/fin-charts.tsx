// Dependency-free SVG charts for the personal finances hub. Pure presentational
// components (no hooks) so they render server- or client-side.

export type Segment = { label: string; value: number; color: string };

// Donut for composition (debt breakdown, spend by category) with a center label.
export function Donut({
  segments,
  size = 150,
  thickness = 20,
  centerTop,
  centerBottom,
}: {
  segments: Segment[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {total > 0 &&
          segments.map((seg, i) => {
            const len = (Math.max(0, seg.value) / total) * circ;
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
      </g>
      {centerTop && (
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="18" fontWeight="700" fill="#EDE9E0">
          {centerTop}
        </text>
      )}
      {centerBottom && (
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize="9" fill="#7A7872" style={{ letterSpacing: "0.1em" }}>
          {centerBottom}
        </text>
      )}
    </svg>
  );
}

// A trend line over time (debt / savings). values = chronological numbers.
export function TrendLine({
  values,
  color = "#625CC8",
  height = 72,
  fill = true,
}: {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  if (!values.length) {
    return <div className="text-[12px] text-bone-mute font-mono py-6 text-center">No history yet — check back as data builds.</div>;
  }
  const W = 100;
  const H = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? W : (i / (values.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 6) - 3;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`tl-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && pts.length > 1 && <path d={area} fill={`url(#tl-${color.replace("#", "")})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Horizontal labeled bars (cashflow split, category spend).
export function Bars({ rows, max }: { rows: Segment[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[12px] text-bone-dim capitalize truncate">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(r.value) / m) * 100)}%`, background: r.color }} />
          </div>
          <span className="w-16 shrink-0 text-right text-[12px] text-bone">
            ${Math.round(r.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
