"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { Button, Card, Input, Label, cx } from "@/components/ui";
import { apiJson } from "@/lib/client/api";
import type { DraftAsset, InspectionDraft } from "@/lib/inspection/draft";
import type { InspectionMode } from "@/lib/tires/types";

interface AssetHit {
  id: string;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  last_odometer: number | null;
}

function AssetPicker({ type, value, onPick }: { type: "truck" | "trailer"; value: DraftAsset | null; onPick: (a: DraftAsset | null, hit?: AssetHit) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await apiJson<{ assets: AssetHit[] }>(`/api/driver/assets?type=${type}&q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setHits(data.assets);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, type, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3 py-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">{t("equipment.selected")}</div>
          <div className="text-[16px] font-bold">{value.unitNumber}</div>
          {value.label ? <div className="text-[12px] text-text-2">{value.label}</div> : null}
        </div>
        <Button size="sm" variant="ghost" type="button" onClick={() => onPick(null)}>
          {t("equipment.change")}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        placeholder={t(type === "truck" ? "equipment.searchTruck" : "equipment.searchTrailer")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        inputMode="search"
        aria-label={t(type === "truck" ? "equipment.searchTruck" : "equipment.searchTrailer")}
      />
      <div className="mt-2 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-border bg-surface">
        {error ? <div className="px-3 py-3 text-[13px] text-status-red">{t("app.offline")}</div> : null}
        {!error && !loading && hits.length === 0 ? <div className="px-3 py-3 text-[13px] text-text-3">{t("equipment.noResults")}</div> : null}
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-2 active:bg-surface-3"
            onClick={() => onPick({ id: h.id, unitNumber: h.unit_number, label: [h.year, h.make, h.model].filter(Boolean).join(" ") || null }, h)}
          >
            <span className="text-[15px] font-semibold">{h.unit_number}</span>
            <span className="text-[12px] text-text-3">{[h.year, h.make, h.model].filter(Boolean).join(" ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  draft: InspectionDraft;
  onChange: (patch: Partial<InspectionDraft>) => void;
  onStart: () => void;
}

export function EquipmentStep({ draft, onChange, onStart }: Props) {
  const t = useT();
  const mode = draft.mode;
  const needsTruck = mode === "truck" || mode === "truck_trailer";
  const needsTrailer = mode === "trailer" || mode === "truck_trailer";
  const ready = !!mode && (!needsTruck || (draft.truck && draft.odometer !== null && draft.odometer > 0)) && (!needsTrailer || draft.trailer);

  const modes: Array<[InspectionMode, string, string]> = [
    ["truck", t("equipment.truckOnly"), "🚛"],
    ["trailer", t("equipment.trailerOnly"), "🚚"],
    ["truck_trailer", t("equipment.both"), "🚛🚚"],
  ];

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-28 pt-4">
      <h1 className="text-[20px] font-bold tracking-tight">{t("equipment.title")}</h1>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {modes.map(([m, label, icon]) => (
          <button
            key={m}
            type="button"
            data-mode={m}
            onClick={() => onChange({ mode: m })}
            className={cx(
              "flex flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] border-2 px-2 py-3 text-[13px] font-semibold transition",
              mode === m ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-text-2",
            )}
          >
            <span className="text-2xl leading-none">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {needsTruck ? (
        <Card className="mt-4 p-4">
          <Label>{t("equipment.truck")}</Label>
          <AssetPicker
            type="truck"
            value={draft.truck}
            onPick={(a, hit) => onChange({ truck: a, odometer: a && hit?.last_odometer && draft.odometer === null ? null : draft.odometer })}
          />
          <div className="mt-3">
            <Label hint={t("equipment.odometerHint")}>{t("equipment.odometer")} *</Label>
            <input
              className="num-input"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="—"
              value={draft.odometer ?? ""}
              onChange={(e) => onChange({ odometer: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })}
              aria-label={t("equipment.odometer")}
            />
          </div>
        </Card>
      ) : null}

      {needsTrailer ? (
        <Card className="mt-4 p-4">
          <Label>{t("equipment.trailer")}</Label>
          <AssetPicker type="trailer" value={draft.trailer} onPick={(a) => onChange({ trailer: a })} />
          <div className="mt-3">
            <Label hint={t("equipment.hubometerHint")}>
              {t("equipment.hubometer")} <span className="font-normal text-text-3">({t("app.optional")})</span>
            </Label>
            <input
              className="num-input"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="—"
              value={draft.hubometer ?? ""}
              onChange={(e) => onChange({ hubometer: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })}
              aria-label={t("equipment.hubometer")}
            />
          </div>
        </Card>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: "calc(12px + var(--safe-bottom))" }}>
        <div className="mx-auto max-w-lg">
          <Button className="w-full" size="lg" disabled={!ready} onClick={onStart} data-testid="start-inspection">
            {t("equipment.start")}
          </Button>
        </div>
      </div>
    </div>
  );
}
