"use client";

import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { getPosition } from "@/lib/tires/layout";
import type { AxleDefinition, InspectionEvaluation, TireReading } from "@/lib/tires/types";
import { TireNode } from "./TireNode";

interface Props {
  axle: AxleDefinition;
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
 * One axle of the diagram: label row with the AVG PSI chip and the Δ L/R
 * chip, then left cells · beam · right cells. Duals carry a = / ≠ tread
 * match glyph between the outer and inner tire (design §1a).
 */
export function AxleRow({ axle, readings, evaluation, selected, onSelect, showPos = true, size = "md" }: Props) {
  const t = useT();
  const cmp = evaluation.axles[axle.key];
  const psis = axle.tires.map((n) => readings[n]?.psi).filter((v): v is number => v !== null && v !== undefined);
  const avg = psis.length === axle.tires.length ? Math.round(psis.reduce((a, b) => a + b, 0) / psis.length) : null;
  const diff = cmp?.sideToSidePsiDiff ?? null;
  const diffStatus = cmp?.sideToSideStatus ?? "none";

  const node = (n: number) => {
    const pos = getPosition(n);
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
    const sym = m === null ? "?" : m ? "=" : "≠";
    const ink = m === null ? "#C6CCD8" : m ? "var(--st-ok)" : "var(--st-crit)";
    return (
      <div className="match-glyph" title={m === null ? "" : t(m ? "tires.compare.treadMatch" : "tires.compare.treadMismatch")}>
        <span style={{ color: ink }}>{sym}</span>
      </div>
    );
  };

  const left = axle.dual ? [axle.tires[0], axle.tires[1]] : [axle.tires[0]];
  const right = axle.dual ? [axle.tires[2], axle.tires[3]] : [axle.tires[1]];

  return (
    <div style={{ padding: "4px 2px 8px" }} data-axle={axle.key}>
      <div className="axle-label">
        <span className="label-xs">{t(axle.labelKey as MessageKey)}</span>
        <span className="chip-mono" style={{ color: "var(--indigo)", background: "var(--indigo-soft)" }}>
          {avg === null ? t("design.avgNone") : t("design.avg", { v: avg })}
        </span>
        {diff !== null ? (
          <span className="chip-mono" data-status={diffStatus} style={{ color: diffStatus === "green" ? "var(--text-3)" : "var(--s)", background: diffStatus === "green" ? "var(--hair-2)" : "var(--s-soft)" }}>
            {t("design.diff", { v: fmt(diff) })}
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 3 }}>
          {node(left[0])}
          {axle.dual ? glyph("left") : null}
          {axle.dual ? node(left[1]) : null}
        </div>
        <div className="beam">
          <span />
          <span className="hub" />
          <span />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 3 }}>
          {node(right[0])}
          {axle.dual ? glyph("right") : null}
          {axle.dual ? node(right[1]) : null}
        </div>
      </div>
    </div>
  );
}
