"use client";

import { useState } from "react";

/**
 * Small dependency-free SVG charts. Single series per chart (never dual-axis),
 * thin marks, recessive grid, hover tooltip, and a table fallback provided by
 * the surrounding page.
 */
export function LineChart({ points, unit, height = 140, decimals = 1, formatX }: { points: { x: string; y: number | null }[]; unit?: string; height?: number; decimals?: number; formatX?: (x: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 600;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const valid = points.filter((p) => p.y !== null) as { x: string; y: number }[];
  if (valid.length === 0) return <div className="py-8 text-center text-[12px] text-text-3">—</div>;
  const ys = valid.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (max - min < 1) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const xs = (i: number) => padL + (points.length === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (points.length - 1));
  const ys2 = (v: number) => padT + (1 - (v - min) / span) * (height - padT - padB);
  const path = points
    .map((p, i) => (p.y === null ? null : `${i === 0 || points[i - 1].y === null ? "M" : "L"}${xs(i).toFixed(1)},${ys2(p.y).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const ticks = [min, min + span / 2, max];
  const fx = formatX ?? ((x: string) => x.slice(5));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={padL} x2={w - padR} y1={ys2(tv)} y2={ys2(tv)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={ys2(tv) + 3} fontSize={10} textAnchor="end" fill="var(--text-3)">
              {tv.toFixed(decimals)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          p.y === null ? null : (
            <g key={p.x}>
              <circle cx={xs(i)} cy={ys2(p.y)} r={hover === i ? 5 : 3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              <rect x={xs(i) - 12} y={padT} width={24} height={height - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          ),
        )}
        {points.map((p, i) =>
          i % Math.max(1, Math.ceil(points.length / 8)) === 0 || i === points.length - 1 ? (
            <text key={p.x} x={xs(i)} y={height - 6} fontSize={10} textAnchor="middle" fill="var(--text-3)">
              {fx(p.x)}
            </text>
          ) : null,
        )}
      </svg>
      {hover !== null && points[hover]?.y !== null ? (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-[var(--shadow-sm)]">
          <span className="text-text-3">{fx(points[hover].x)}</span> <span className="font-semibold tabular-nums">{points[hover].y?.toFixed(decimals)}</span> {unit}
        </div>
      ) : null}
    </div>
  );
}
