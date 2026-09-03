import { heatColor } from "@/lib/heat";

export interface HeatCell {
  /** `${slot}/${axleKey}:${ABBR}` or `${slot}/spare-n` */
  position_key: string;
  value: number | null;
  red: number;
  yellow: number;
  n: number;
}

const SLOT_ORDER = ["truck", "jeep", "trailer", "dolly", "booster", "trailer2"];
const ABBR_ORDER = ["L", "LO", "LI", "RI", "RO", "R"];

/**
 * Tire-layout shaped heatmap: one cell per position key seen in the period,
 * grouped by component and axle in the same arrangement as the inspection
 * diagram, colored by the average value (darker = lower).
 */
export function PositionHeatmap({ cells, unit, decimals = 1 }: { cells: HeatCell[]; unit: string; decimals?: number }) {
  const values = cells.map((c) => c.value).filter((v): v is number => v !== null);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const rows = new Map<string, HeatCell[]>();
  for (const c of cells) {
    const [slot, rest] = c.position_key.split("/");
    const axle = rest?.includes(":") ? rest.split(":")[0] : "spare";
    const key = `${slot}/${axle}`;
    rows.set(key, [...(rows.get(key) ?? []), c]);
  }
  const ordered = [...rows.entries()].sort(([a], [b]) => {
    const [sa, xa] = a.split("/");
    const [sb, xb] = b.split("/");
    const so = SLOT_ORDER.indexOf(sa) - SLOT_ORDER.indexOf(sb);
    if (so !== 0) return so;
    if (xa === "spare") return 1;
    if (xb === "spare") return -1;
    return xa.localeCompare(xb, undefined, { numeric: true });
  });
  const cell = (c: HeatCell) => {
    const v = c.value;
    const dark = v !== null && (v - min) / Math.max(1e-6, max - min) < 0.5;
    const abbr = c.position_key.includes(":") ? c.position_key.split(":")[1] : "SP";
    return (
      <div
        key={c.position_key}
        className="flex h-12 w-12 flex-col items-center justify-center rounded-md border border-border text-[11px] leading-tight"
        style={{ background: heatColor(v, min, max, true), color: dark ? "#fff" : "var(--text)" }}
        title={`${c.position_key} · ${v === null ? "—" : `${v.toFixed(decimals)} ${unit}`} · n=${c.n} · red ${c.red} · yellow ${c.yellow}`}
      >
        <span className="font-bold">{abbr}</span>
        <span className="tabular-nums">{v === null ? "—" : v.toFixed(decimals)}</span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      {ordered.map(([key, list]) => {
        const sorted = [...list].sort((a, b) => ABBR_ORDER.indexOf(a.position_key.split(":")[1] ?? "") - ABBR_ORDER.indexOf(b.position_key.split(":")[1] ?? ""));
        const dual = sorted.length === 4;
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-24 truncate text-[10px] font-semibold uppercase tracking-wide text-text-3" title={key}>{key.replace("/", " · ")}</span>
            <div className="flex gap-1">
              {dual ? (
                <>
                  {cell(sorted[0])}
                  {cell(sorted[1])}
                  <span className="w-4" />
                  {cell(sorted[2])}
                  {cell(sorted[3])}
                </>
              ) : sorted.length === 2 ? (
                <>
                  {cell(sorted[0])}
                  <span className="w-[116px]" />
                  {cell(sorted[1])}
                </>
              ) : (
                sorted.map(cell)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
