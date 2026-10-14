/**
 * charts.jsx — small SVG charts in the app's green style. No chart library:
 * each chart is a few dozen lines, scales with its container (viewBox) and
 * shows exact values on hover (<title>).
 */

import React from "react";

const GREEN = "#16935C";

// Smooth path through points (Catmull-Rom converted to cubic Béziers).
function smooth(points) {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// A "round" step (1, 2, 2.5 or 5 × 10^k) so axis labels read 0, 1k, 2k, 3k…
function niceStep(max, parts) {
  if (max <= 0) return 1;
  const raw = max / parts;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
function niceMax(v, parts = 4) {
  return niceStep(v, parts) * parts;
}

export function AreaChart({ data, format = (v) => v, height = 220, labelEvery = 1 }) {
  const W = 640, H = height, L = 48, R = 24, T = 30, B = 28;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const x = (i) => L + 14 + (i * (W - L - R - 14)) / Math.max(1, data.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const line = smooth(pts);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Area chart">
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0.32" />
          <stop offset="100%" stopColor={GREEN} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#E4ECE6" strokeDasharray={t ? "4 4" : ""} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#62766B">{format(Math.round(t))}</text>
        </g>
      ))}
      {data.length > 1 && <path d={`${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="url(#area-fill)" />}
      <path d={line} fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={d.label}>
          <circle cx={x(i)} cy={y(d.value)} r="5" fill="#fff" stroke={GREEN} strokeWidth="3">
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </circle>
          {i % labelEvery === 0 && d.value > 0 && (
            <text x={x(i)} y={y(d.value) - 12} textAnchor="middle" fontSize="12" fontWeight="700" fill="#0F1F17">{format(d.value)}</text>
          )}
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="12" fill="#33493D">{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

export function BarChart({ data, height = 200 }) {
  const W = 560, H = height, L = 36, R = 12, T = 26, B = 28;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0), 2);
  const band = (W - L - R) / data.length;
  const bw = Math.min(84, band * 0.56);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bar chart">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} stroke="#E4ECE6" strokeDasharray={f ? "4 4" : ""} />
          <text x={L - 8} y={y(f * max) + 4} textAnchor="end" fontSize="11" fill="#62766B">{Math.round(f * max)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = L + band * i + band / 2;
        const top = y(d.value);
        const h = Math.max(4, y(0) - top);
        return (
          <g key={d.label}>
            <rect x={cx - bw / 2} y={y(0) - h} width={bw} height={h} rx="10" fill={d.color}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            <text x={cx} y={y(0) - h - 8} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0F1F17">{d.value}</text>
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="12" fill="#33493D">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ value, size = 140, stroke = 18, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${v}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E3F4EA" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GREEN} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy={label ? "0" : "0.35em"} textAnchor="middle" fontSize={size * 0.2} fontWeight="800" fill="#0F1F17">
        {value == null ? "–" : `${Math.round(v)}%`}
      </text>
      {label && <text x="50%" y="50%" dy="1.6em" textAnchor="middle" fontSize="11" fill="#62766B">{label}</text>}
    </svg>
  );
}

export function Sparkline({ values, color = "#0D6540", height = 70 }) {
  const W = 300, H = height, P = 6;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => [P + (i * (W - 2 * P)) / Math.max(1, values.length - 1),
    P + (H - 2 * P) * (1 - (v - min) / (max - min || 1))]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
      <path d={smooth(pts)} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
