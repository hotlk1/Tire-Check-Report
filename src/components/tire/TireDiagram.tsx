"use client";

import { useT } from "@/i18n/client";
import { axlesForMode, getPosition, SPARES, vehiclesForMode } from "@/lib/tires/layout";
import type { InspectionEvaluation, InspectionMode, TireReading, VehicleKind } from "@/lib/tires/types";
import { AxleRow } from "./AxleRow";
import { TireNode } from "./TireNode";

export interface TireDiagramProps {
  mode: InspectionMode;
  readings: Record<number, TireReading | undefined>;
  evaluation: InspectionEvaluation;
  selected?: number | null;
  onSelect?: (n: number) => void;
  labels?: Partial<Record<VehicleKind, string>>;
  showValues?: boolean;
  size?: "sm" | "md" | "lg";
  /** Hide the spares row (e.g. compact report thumbnails). */
  hideSpares?: boolean;
}

/**
 * Top-down rig diagram: steer axle at the front, drive axles, then the
 * trailer axles, spares at the bottom. Every tire is tappable in any order.
 */
export function TireDiagram({ mode, readings, evaluation, selected, onSelect, labels, showValues = true, size = "md", hideSpares }: TireDiagramProps) {
  const t = useT();
  const vehicles = vehiclesForMode(mode);
  const axles = axlesForMode(mode);

  return (
    <div className="flex flex-col items-stretch gap-3" data-diagram>
      {vehicles.map((vehicle) => {
        const vAxles = axles.filter((a) => a.vehicle === vehicle);
        const isTruck = vehicle === "truck";
        return (
          <section
            key={vehicle}
            className="relative rounded-[var(--radius-lg)] border border-border bg-surface px-2 pb-4 pt-2 shadow-[var(--shadow-sm)]"
            data-vehicle={vehicle}
          >
            <header className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">{t(isTruck ? "equipment.truck" : "equipment.trailer")}</span>
              {labels?.[vehicle] ? <span className="rounded-md bg-surface-3 px-2 py-0.5 text-[12px] font-semibold text-text-2">{labels[vehicle]}</span> : null}
            </header>

            {/* chassis */}
            <div className="relative">
              <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 flex justify-center">
                <div className="frame-rail my-6" />
              </div>
              {isTruck ? (
                <div className="relative mx-auto mb-3 flex h-9 w-[46%] items-end justify-center rounded-t-[22px] rounded-b-md border-2 border-dashed border-border-strong bg-surface-2 text-[10px] font-bold tracking-[0.12em] text-text-3">
                  <span className="pb-1">{t("inspection.front")}</span>
                </div>
              ) : (
                <div className="relative mx-auto mb-3 h-5 w-[70%] rounded-md border-2 border-dashed border-border-strong bg-surface-2" />
              )}
              <div className="relative flex flex-col gap-4">
                {vAxles.map((axle) => (
                  <AxleRow key={axle.key} axle={axle} readings={readings} evaluation={evaluation} selected={selected} onSelect={onSelect} showValues={showValues} size={size} />
                ))}
              </div>
              {!isTruck ? <div className="relative mx-auto mt-3 h-3 w-[70%] rounded-md border-2 border-dashed border-border-strong bg-surface-2" /> : null}
            </div>
          </section>
        );
      })}

      {!hideSpares ? (
        <section className="rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface-2 px-3 py-2" data-spares>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">{t("inspection.spares")}</span>
            <span className="text-[11px] text-text-3">{t("inspection.spareOptional")}</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-8">
            {vehicles.map((v) => {
              const n = SPARES[v];
              const pos = getPosition(n);
              const r = readings[n];
              const ev = evaluation.tires[n];
              return (
                <TireNode
                  key={n}
                  number={n}
                  abbreviation={`${pos.abbreviation} · ${t(v === "truck" ? "equipment.truck" : "equipment.trailer")}`}
                  status={ev?.overall ?? "none"}
                  psi={null}
                  tread32={r?.tread32 ?? null}
                  requiresPsi={false}
                  selected={selected === n}
                  photoMissing={ev?.photoMissing}
                  showValues={showValues}
                  onSelect={onSelect}
                  size={size === "lg" ? "md" : "sm"}
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function DiagramLegend() {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-2">
      {(["none", "green", "yellow", "red"] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5" data-status={s}>
          <span className="status-dot" />
          {t(`inspection.legend.${s}`)}
        </span>
      ))}
    </div>
  );
}
