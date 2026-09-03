"use client";

import { useT } from "@/i18n/client";
import { axleLabel, componentName } from "@/lib/equipment/labels";
import type { InspectionLayout } from "@/lib/equipment/layout";
import type { InspectionEvaluation, TireReading } from "@/lib/tires/types";
import { AxleRow, photoStateOf } from "./AxleRow";
import { TireNode } from "./TireNode";

export interface TireDiagramProps {
  layout: InspectionLayout;
  readings: Record<number, TireReading | undefined>;
  evaluation: InspectionEvaluation;
  selected?: number | null;
  onSelect?: (n: number) => void;
  showPos?: boolean;
  size?: "sm" | "md" | "lg";
  hideSpares?: boolean;
  hideLegend?: boolean;
}

/**
 * Printed-axle-report layout rebuilt as touch cards (design §1a): one card
 * per component (tractor, jeep, trailer, dolly, booster) with axle rows,
 * then a SPARES card, rendered from the inspection's layout snapshot.
 */
export function TireDiagram({ layout, readings, evaluation, selected, onSelect, showPos = true, size = "md", hideSpares, hideLegend }: TireDiagramProps) {
  const t = useT();
  const spares = layout.positions.filter((p) => p.isSpare);

  return (
    <div data-diagram>
      {layout.components.map((c) => (
        <section key={c.slot} className="card" style={{ marginBottom: 14, padding: "12px 10px 10px" }} data-vehicle={c.slot} data-kind={c.kind}>
          <header className="group-head">
            <span className="dot" />
            <span className="name">{componentName(t, c).toUpperCase()}</span>
            <span className="rule" />
            <span className="unit">{[c.unitNumber, c.label].filter(Boolean).join(" · ")}</span>
          </header>
          {c.axles.map((axle) => (
            <AxleRow key={axle.key} axle={axle} label={axleLabel(t, c, axle)} layout={layout} readings={readings} evaluation={evaluation} selected={selected} onSelect={onSelect} showPos={showPos} size={size} />
          ))}
        </section>
      ))}

      {!hideSpares && spares.length ? (
        <section className="card" style={{ marginBottom: 14, padding: "12px 10px 10px" }} data-spares>
          <header className="group-head">
            <span className="dot" />
            <span className="name">{t("inspection.spares").toUpperCase()}</span>
            <span className="rule" />
            <span className="unit">{t("inspection.spareOptional")} · {t("design.treadOnly")}</span>
          </header>
          <div style={{ padding: "4px 2px 8px" }}>
            <div className="axle-label">
              <span className="label-xs">{t("design.mountedSpares")}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {spares.map((pos, i) => {
                const r = readings[pos.number];
                const ev = evaluation.tires[pos.number];
                const component = layout.components.find((c) => c.slot === pos.slot)!;
                return (
                  <div key={pos.number} style={{ textAlign: "center" }}>
                    <TireNode
                      number={pos.number}
                      abbreviation={`SP${i + 1}`}
                      status={ev?.overall ?? "none"}
                      treadStatus={ev?.treadStatus ?? "none"}
                      tread32={r?.tread32 ?? null}
                      requiresPsi={false}
                      isSpare
                      absent={!!r?.absent}
                      selected={selected === pos.number}
                      photoState={photoStateOf(r, !!ev?.photoMissing)}
                      hasDamage={!!r && r.damage !== "none"}
                      showPos={false}
                      onSelect={onSelect}
                      size={size}
                    />
                    {showPos ? <div className="tire-pos">{componentName(t, component)}</div> : null}
                  </div>
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
