import { AXLES, getPosition, SPARES } from "@/lib/tires/layout";
import { heatColor } from "@/lib/heat";

interface Cell {
  tire_number: number;
  value: number | null;
  red: number;
  yellow: number;
  n: number;
}

/**
 * Tire-layout shaped heatmap: one cell per position in the same arrangement
 * as the inspection diagram, colored by the average value (darker = lower).
 */
export function PositionHeatmap({ cells, unit, decimals = 1 }: { cells: Cell[]; unit: string; decimals?: number }) {
  const map = new Map(cells.map((c) => [c.tire_number, c]));
  const values = cells.map((c) => c.value).filter((v): v is number => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const cell = (n: number) => {
    const c = map.get(n);
    const v = c?.value ?? null;
    const dark = v !== null && (v - min) / Math.max(1e-6, max - min) < 0.5;
    const pos = getPosition(n);
    return (
      <div
        key={n}
        className="flex h-12 w-12 flex-col items-center justify-center rounded-md border border-border text-[11px] leading-tight"
        style={{ background: heatColor(v, min, max, true), color: dark ? "#fff" : "var(--text)" }}
        title={`#${n} ${pos.abbreviation} · ${v === null ? "—" : `${v.toFixed(decimals)} ${unit}`} · n=${c?.n ?? 0} · red ${c?.red ?? 0} · yellow ${c?.yellow ?? 0}`}
      >
        <span className="font-bold">{n}</span>
        <span className="tabular-nums">{v === null ? "—" : v.toFixed(decimals)}</span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      {AXLES.map((a) => (
        <div key={a.key} className="flex items-center gap-1.5">
          <span className="w-16 text-[10px] font-semibold uppercase tracking-wide text-text-3">{a.key.replace("truck-", "").replace("trailer-", "T ")}</span>
          <div className="flex gap-1">
            {a.dual ? (
              <>
                {cell(a.tires[0])}
                {cell(a.tires[1])}
                <span className="w-4" />
                {cell(a.tires[2])}
                {cell(a.tires[3])}
              </>
            ) : (
              <>
                {cell(a.tires[0])}
                <span className="w-[116px]" />
                {cell(a.tires[1])}
              </>
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="w-16 text-[10px] font-semibold uppercase tracking-wide text-text-3">Spares</span>
        <div className="flex gap-1">
          {cell(SPARES.truck)}
          {cell(SPARES.trailer)}
        </div>
      </div>
    </div>
  );
}
