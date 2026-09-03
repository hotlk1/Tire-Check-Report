"use client";

import { useT } from "@/i18n/client";
import type { InspectionLayout, LayoutAxle } from "@/lib/equipment/layout";
import type { InspectionEvaluation, TireReading } from "@/lib/tires/types";
import { TireNode } from "./TireNode";

interface Props {
  axle: LayoutAxle;
  label: string;
  layout: InspectionLayout;
  readings: Record<number, TireReading | undefined>;
  evaluation: InspectionEvaluation;
  selected?: number | null;
  onSelect?: (n: number) => void;
  showPos?: boolean;
  size?: "sm" | "md" | "lg";
}

function fmt(v: number | null) {
  if (v === null) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function photoStateOf(r: TireReading | undefined, photoMissing: boolean): "none" | "photo" | "need" {
  if (photoMissing) return "need";
  if (r && r.photoCount > 0) return "photo";
  return "none";
}

/**
 * One axle drawn like the real thing: a beam runs across the row with a hub
 * in the middle; the left and right tires sit tightly on each end (duals as
 * a pair with the `=` / `≠` tread-match glyph on the beam between them) and
 * the side-to-side PSI difference chip sits on the beam between the sides.
 */
export function AxleRow({ axle, label, layout, readings, evaluation, selected, onSelect, showPos = true, size = "md" }: Props) {
  const t = useT();
  const cmp = evaluation.axles[axle.key];
  const psis = axle.tires.map((n) => readings[n]?.psi).filter((v): v is number => v !== null && v !== undefined);
  const avg = psis.length === axle.tires.length ? Math.round(psis.reduce((a, b) => a + b, 0) / psis.length) : null;
  const diff = cmp?.sideToSidePsiDiff ?? null;
  const diffStatus = cmp?.sideToSideStatus ?? "none";

  const node = (n: number) => {
    const pos = layout.positions.find((p) => p.number === n)!;
    const ev = evaluation.tires[n];
    const r = readings[n];
    return (
      <TireNode
        key={n}
        number={n}
        abbreviation={pos.abbreviation}
        status={ev?.overall ?? "none"}
        psiStatus={ev?.psiStatus ?? "none"}
        treadStatus={ev?.treadStatus ?? "none"}
        psi={r?.psi ?? null}
        tread32={r?.tread32 ?? null}
        requiresPsi={pos.requiresPsi}
        selected={selected === n}
        photoState={photoStateOf(r, !!ev?.photoMissing)}
        hasDamage={!!r && r.damage !== "none"}
        showPos={showPos}
        onSelect={onSelect}
        size={size}
      />
    );
  };

  const glyph = (side: "left" | "right") => {
    const pair = cmp?.pairs.find((p) => p.side === side);
    const m = pair?.treadMatch ?? null;
    const sym = m === null ? "·" : m ? "=" : "≠";
    return (
      <span className="match-glyph" data-match={m === null ? "none" : m ? "yes" : "no"} title={m === null ? "" : t(m ? "tires.compare.treadMatch" : "tires.compare.treadMismatch")} aria-label={m === null ? undefined : t(m ? "tires.compare.treadMatch" : "tires.compare.treadMismatch")}>
        {sym}
      </span>
    );
  };

  const left = axle.dual ? [axle.tires[0], axle.tires[1]] : [axle.tires[0]];
  const right = axle.dual ? [axle.tires[2], axle.tires[3]] : [axle.tires[1]];

  return (
    <div className="axle" data-axle={axle.key} data-role={axle.role} data-dual={axle.dual}>
      <div className="axle-head">
        <span className="label-xs">
          {label}
          {axle.liftable ? <span style={{ marginLeft: 6, opacity: 0.7 }}>· {t("equipment.liftable")}</span> : null}
        </span>
        <span className="chip-mono" style={{ color: "var(--indigo)", background: "var(--indigo-soft)" }}>{avg === null ? t("design.avgNone") : t("design.avg", { v: avg })}</span>
      </div>
      <div className="axle-row">
        <div className="axle-beam" aria-hidden>
          <span className="hub" />
        </div>
        <div className="axle-side">
          {node(left[0])}
          {axle.dual ? glyph("left") : null}
          {axle.dual ? node(left[1]) : null}
        </div>
        <div className="axle-mid">
          {diff !== null ? (
            <span className="chip-mono axle-diff" data-status={diffStatus} title={t("tires.compare.sideToSide")}>
              {t("design.diffShort", { v: fmt(diff) })}
            </span>
          ) : null}
        </div>
        <div className="axle-side">
          {node(right[0])}
          {axle.dual ? glyph("right") : null}
          {axle.dual ? node(right[1]) : null}
        </div>
      </div>
    </div>
  );
}
