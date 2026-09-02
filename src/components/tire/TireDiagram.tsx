"use client";

import { useT } from "@/i18n/client";
import { axlesForMode, getPosition, SPARES, vehiclesForMode } from "@/lib/tires/layout";
import type { InspectionEvaluation, InspectionMode, TireReading, VehicleKind } from "@/lib/tires/types";
import { AxleRow, photoStateOf } from "./AxleRow";
import { TireNode } from "./TireNode";

export interface TireDiagramProps {
  mode: InspectionMode;
  readings: Record<number, TireReading | undefined>;
  evaluation: InspectionEvaluation;
  selected?: number | null;
  onSelect?: (n: number) => void;
  /** Unit labels shown in the group header, e.g. "Truck 4182 · Cascadia". */
  labels?: Partial<Record<VehicleKind, string>>;
  showPos?: boolean;
  size?: "sm" | "md" | "lg";
  hideSpares?: boolean;
  hideLegend?: boolean;
}

/**
 * Printed-axle-report layout rebuilt as touch cards (design §1a): TRACTOR,
 * TRAILER and SPARES groups, each a white card with axle rows.
 */
export function TireDiagram({ mode, readings, evaluation, selected, onSelect, labels, showPos = true, size = "md", hideSpares, hideLegend }: TireDiagramProps) {
  const t = useT();
  const vehicles = vehiclesForMode(mode);
  const axles = axlesForMode(mode);

  return (
    <div data-diagram>
      {vehicles.map((vehicle) => (
        <section key={vehicle} className="card" style={{ marginBottom: 14, padding: "12px 10px 10px" }} data-vehicle={vehicle}>
          <header className="group-head">
            <span className="dot" />
            <span className="name">{t(vehicle === "truck" ? "design.tractor" : "equipment.trailer").toUpperCase()}</span>
            <span className="rule" />
            <span className="unit">{labels?.[vehicle] ?? ""}</span>
          </header>
          {axles
            .filter((a) => a.vehicle === vehicle)
            .map((axle) => (
              <AxleRow key={axle.key} axle={axle} readings={readings} evaluation={evaluation} selected={selected} onSelect={onSelect} showPos={showPos} size={size} />
            ))}
        </section>
      ))}

      {!hideSpares ? (
        <section className="card" style={{ marginBottom: 14, padding: "12px 10px 10px" }} data-spares>
          <header className="group-head">
            <span className="dot" />
            <span className="name">{t("inspection.spares").toUpperCase()}</span>
            <span className="rule" />
            <span className="unit">{t("design.treadOnly")}</span>
          </header>
          <div style={{ padding: "4px 2px 8px" }}>
            <div className="axle-label">
              <span className="label-xs">{t("design.mountedSpares")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
              {vehicles.map((v) => {
                const n = SPARES[v];
                const pos = getPosition(n);
                const r = readings[n];
                const ev = evaluation.tires[n];
                return (
                  <TireNode
                    key={n}
                    number={n}
                    abbreviation={v === "truck" ? "SP1" : "SP2"}
                    status={ev?.overall ?? "none"}
                    treadStatus={ev?.treadStatus ?? "none"}
                    tread32={r?.tread32 ?? null}
                    requiresPsi={pos.requiresPsi}
                    isSpare
                    absent={!!r?.absent}
                    selected={selected === n}
                    photoState={photoStateOf(r, !!ev?.photoMissing)}
                    hasDamage={!!r && r.damage !== "none"}
                    showPos={showPos}
                    onSelect={onSelect}
                    size={size}
                  />
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {!hideLegend ? <DiagramLegend /> : null}
    </div>
  );
}

export function DiagramLegend() {
  const t = useT();
  return (
    <div className="legend">
      <span className="flex items-center gap-[5px]" data-status="none"><span className="sw" />{t("design.legend.notDone")}</span>
      <span className="flex items-center gap-[5px]" data-status="green"><span className="sw" />{t("design.legend.ok")}</span>
      <span className="flex items-center gap-[5px]" data-status="yellow"><span className="sw" />{t("design.legend.watch")}</span>
      <span className="flex items-center gap-[5px]" data-status="red"><span className="sw" />{t("design.legend.critical")}</span>
      <span className="flex items-center gap-[5px]"><span style={{ font: "700 12px/1 var(--font-sans)", color: "var(--st-ok)" }}>=</span>{t("design.legend.matched")}</span>
    </div>
  );
}
