"use client";

import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { getPosition } from "@/lib/tires/layout";
import type { AxleComparison, AxleDefinition, DualPairComparison, InspectionEvaluation, TireReading } from "@/lib/tires/types";
import { TireNode } from "./TireNode";

interface Props {
  axle: AxleDefinition;
  readings: Record<number, TireReading | undefined>;
  evaluation: InspectionEvaluation;
  selected?: number | null;
  onSelect?: (n: number) => void;
  showValues?: boolean;
  size?: "sm" | "md" | "lg";
}

function fmtDiff(v: number | null) {
  if (v === null) return "–";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function PairChip({ pair }: { pair: DualPairComparison }) {
  const t = useT();
  const ready = pair.psiDiff !== null || pair.treadDiff !== null;
  const status = pair.psiStatus;
  const sym = pair.treadMatch === null ? "·" : pair.treadMatch ? "=" : "≠";
  const title = ready
    ? `${t("tires.compare.pair")}: ${t("tires.compare.psiDiff", { value: fmtDiff(pair.psiDiff) })} · ${pair.treadMatch === false ? t("tires.compare.treadMismatch") : t("tires.compare.treadMatch")}`
    : t("tires.compare.pair");
  return (
    <div className="compare-chip" data-status={ready ? status : "none"} title={title} aria-label={title}>
      <span>{pair.psiDiff === null ? "Δ–" : `Δ${fmtDiff(pair.psiDiff)}`}</span>
      <span className="sym" style={{ color: pair.treadMatch === false ? "var(--status-red)" : undefined }}>
        {sym}
      </span>
    </div>
  );
}

function CenterChip({ axle, cmp }: { axle: AxleDefinition; cmp: AxleComparison }) {
  const t = useT();
  const ready = cmp.sideToSidePsiDiff !== null;
  const title = `${t(axle.labelKey as MessageKey)} · ${t("tires.compare.sideToSide")}: ${ready ? t("tires.compare.psiDiff", { value: fmtDiff(cmp.sideToSidePsiDiff) }) : "–"}`;
  return (
    <div className="compare-chip min-w-[52px]" data-status={ready ? cmp.sideToSideStatus : "none"} title={title} aria-label={title}>
      <span className="text-[9px] font-bold tracking-wide opacity-80">L↔R</span>
      <span>{ready ? `Δ${fmtDiff(cmp.sideToSidePsiDiff)}` : "Δ–"}</span>
    </div>
  );
}

export function AxleRow({ axle, readings, evaluation, selected, onSelect, showValues = true, size = "md" }: Props) {
  const cmp = evaluation.axles[axle.key];
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
        psi={r?.psi ?? null}
        tread32={r?.tread32 ?? null}
        requiresPsi={pos.requiresPsi}
        selected={selected === n}
        photoMissing={ev?.photoMissing}
        showValues={showValues}
        onSelect={onSelect}
        size={size}
      />
    );
  };

  if (!axle.dual) {
    const [l, r] = axle.tires;
    return (
      <div className="flex items-center justify-center gap-1.5" data-axle={axle.key}>
        {node(l)}
        <div className="axle-line" />
        {cmp ? <CenterChip axle={axle} cmp={cmp} /> : null}
        <div className="axle-line" />
        {node(r)}
      </div>
    );
  }

  const [lo, li, ri, ro] = axle.tires;
  const left = cmp?.pairs.find((p) => p.side === "left");
  const right = cmp?.pairs.find((p) => p.side === "right");
  return (
    <div className="flex items-center justify-center gap-1" data-axle={axle.key}>
      {node(lo)}
      {left ? <PairChip pair={left} /> : null}
      {node(li)}
      <div className="axle-line" />
      {cmp ? <CenterChip axle={axle} cmp={cmp} /> : null}
      <div className="axle-line" />
      {node(ri)}
      {right ? <PairChip pair={right} /> : null}
      {node(ro)}
    </div>
  );
}
