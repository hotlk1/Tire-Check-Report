"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
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

function AssetPicker({ type, value, onPick }: { type: "truck" | "trailer"; value: DraftAsset | null; onPick: (a: DraftAsset | null) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const data = await apiJson<{ assets: AssetHit[] }>(`/api/driver/assets?type=${type}&q=${encodeURIComponent(q)}`);
        if (!cancelled) {
          setHits(data.assets);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, type, value]);

  if (value) {
    return (
      <div className="unit-row" style={{ marginTop: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--st-ok)", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h3">{value.unitNumber}</div>
          {value.label ? <div style={{ font: "500 11.5px/1.2 var(--font-sans)", color: "var(--muted)", marginTop: 2 }}>{value.label}</div> : null}
        </div>
        <button type="button" className="a-link" onClick={() => onPick(null)}>
          {t("equipment.change")}
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className="field" style={{ height: 50 }}>
        <input
          style={{ font: "500 15px/1 var(--font-sans)" }}
          placeholder={t(type === "truck" ? "equipment.searchTruck" : "equipment.searchTrailer")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          inputMode="search"
          aria-label={t(type === "truck" ? "equipment.searchTruck" : "equipment.searchTrailer")}
        />
      </div>
      <div className="pill-list scr" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
        {error ? <div style={{ padding: "12px 14px", font: "500 13px/1 var(--font-sans)", color: "var(--st-crit)" }}>{t("app.offline")}</div> : null}
        {!error && hits.length === 0 ? <div style={{ padding: "12px 14px", font: "500 13px/1 var(--font-sans)", color: "var(--muted)" }}>{t("equipment.noResults")}</div> : null}
        {hits.map((h) => (
          <button key={h.id} type="button" onClick={() => onPick({ id: h.id, unitNumber: h.unit_number, label: [h.year, h.make, h.model].filter(Boolean).join(" ") || null })}>
            <span style={{ font: "700 15px/1 var(--font-sans)", color: "var(--ink)" }}>{h.unit_number}</span>
            <span style={{ font: "500 12px/1 var(--font-sans)", color: "var(--muted)" }}>{[h.year, h.make, h.model].filter(Boolean).join(" ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MiField({ value, onChange, placeholder, testId, label }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; testId: string; label: string }) {
  return (
    <div className="field" style={{ marginTop: 7 }}>
      <input inputMode="numeric" pattern="[0-9]*" placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")))} aria-label={label} data-testid={testId} />
      <span className="field-suffix">MI</span>
    </div>
  );
}

interface Props {
  draft: InspectionDraft;
  onChange: (patch: Partial<InspectionDraft>) => void;
  onStart: () => void;
  onBack: () => void;
}

/** "What are you inspecting?" (design §1a step 2). */
export function EquipmentStep({ draft, onChange, onStart, onBack }: Props) {
  const t = useT();
  const mode = draft.mode;
  const needsTruck = mode === "truck" || mode === "truck_trailer";
  const needsTrailer = mode === "trailer" || mode === "truck_trailer";
  const ready = !!mode && (!needsTruck || (draft.truck && draft.odometer !== null && draft.odometer > 0)) && (!needsTrailer || draft.trailer);
  const modes: Array<[InspectionMode, string]> = [
    ["truck", t("equipment.truck")],
    ["trailer", t("equipment.trailer")],
    ["truck_trailer", t("equipment.both")],
  ];
  return (
    <>
      <div className="scr mx-auto w-full max-w-lg flex-1 overflow-auto" style={{ padding: "26px 20px 20px", minHeight: 0 }}>
        <div className="h2">{t("equipment.title")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
          {modes.map(([m, label]) => (
            <button key={m} type="button" className="mode-btn" data-active={mode === m} data-mode={m} onClick={() => onChange({ mode: m })}>
              {m === "truck" ? <span style={{ width: 34, height: 14, borderRadius: 3, background: "currentColor", opacity: 0.85 }} /> : null}
              {m === "trailer" ? <span style={{ width: 44, height: 11, borderRadius: 2, background: "currentColor", opacity: 0.85 }} /> : null}
              {m === "truck_trailer" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 20, height: 14, borderRadius: 3, background: "currentColor", opacity: 0.85 }} />
                  <span style={{ width: 26, height: 11, borderRadius: 2, background: "currentColor", opacity: 0.85 }} />
                </span>
              ) : null}
              {label}
            </button>
          ))}
        </div>

        {needsTruck ? (
          <div className="card-sm" style={{ marginTop: 22, padding: 16 }}>
            <div className="label">{t("design.tractor")}</div>
            <AssetPicker type="truck" value={draft.truck} onPick={(a) => onChange({ truck: a })} />
            <div style={{ marginTop: 12 }}>
              <div style={{ font: "600 12px/1 var(--font-sans)", color: "var(--text-2)", letterSpacing: ".02em" }}>
                {t("equipment.odometer")} <span style={{ color: "var(--st-crit)" }}>{t("app.required")}</span>
              </div>
              <MiField value={draft.odometer} onChange={(v) => onChange({ odometer: v })} placeholder="000000" testId="odometer" label={t("equipment.odometer")} />
            </div>
          </div>
        ) : null}

        {needsTrailer ? (
          <div className="card-sm" style={{ marginTop: 14, padding: 16 }}>
            <div className="label">{t("equipment.trailer")}</div>
            <AssetPicker type="trailer" value={draft.trailer} onPick={(a) => onChange({ trailer: a })} />
            <div style={{ marginTop: 12 }}>
              <div style={{ font: "600 12px/1 var(--font-sans)", color: "var(--text-2)" }}>
                {t("equipment.hubometer")} <span style={{ color: "var(--muted)", fontWeight: 500 }}>{t("app.optional")}</span>
              </div>
              <MiField value={draft.hubometer} onChange={(v) => onChange({ hubometer: v })} placeholder="000000" testId="hubometer" label={t("equipment.hubometer")} />
            </div>
          </div>
        ) : null}
      </div>
      <div style={{ flex: "none", padding: "14px 20px calc(26px + var(--safe-bottom))", display: "flex", gap: 10 }} className="mx-auto w-full max-w-lg">
        <button type="button" className="btn-secondary" style={{ width: 70 }} onClick={onBack}>
          {t("app.back")}
        </button>
        <button type="button" className="btn-primary" style={{ flex: 1 }} disabled={!ready} onClick={onStart} data-testid="start-inspection">
          {t("equipment.start")}
        </button>
      </div>
    </>
  );
}
