"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { apiJson } from "@/lib/client/api";
import { SLOT_KIND, type ComponentSlot } from "@/lib/equipment/layout";
import { defaultConfigFor, templateByKey } from "@/lib/equipment/templates";
import type { ComponentKind, EquipmentConfig } from "@/lib/equipment/types";
import { wheelPositionsOf } from "@/lib/equipment/types";
import { baseModeOf, componentsForMode, emptyComponent, type BaseMode, type DraftAsset, type DraftComponent, type InspectionDraft } from "@/lib/inspection/draft";
import { equipmentIssues, type EquipmentIssue } from "@/lib/inspection/validation";
import type { DriverEquipment } from "@/lib/repos/equipment";

interface AssetHit {
  id: string;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  last_odometer: number | null;
}

export interface EquipmentSelection {
  components: DraftComponent[];
  odometer: number | null;
  hubometer: number | null;
}

function AssetPicker({ kind, value, onPick, invalid, inputRef }: { kind: ComponentKind; value: DraftAsset | null; onPick: (a: DraftAsset | null) => void; invalid?: boolean; inputRef?: (el: HTMLInputElement | null) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [error, setError] = useState(false);
  const kindLabel = t(`equipment.kinds.${kind}` as MessageKey);

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const data = await apiJson<{ assets: AssetHit[] }>(`/api/driver/assets?type=${kind}&q=${encodeURIComponent(q)}`);
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
  }, [q, kind, value]);

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
      <div className="field" style={{ height: 50, ...(invalid ? { boxShadow: "0 0 0 2px var(--st-crit)" } : {}) }}>
        <input
          ref={inputRef}
          style={{ font: "500 15px/1 var(--font-sans)" }}
          placeholder={t("equipment.searchUnit", { kind: kindLabel })}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          inputMode="search"
          aria-label={t("equipment.searchUnit", { kind: kindLabel })}
          aria-invalid={invalid || undefined}
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

function MiField({ value, onChange, placeholder, testId, label, invalid, inputRef }: { value: number | null; onChange: (v: number | null) => void; placeholder: string; testId: string; label: string; invalid?: boolean; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  return (
    <div className="field" style={{ marginTop: 7, ...(invalid ? { boxShadow: "0 0 0 2px var(--st-crit)" } : {}) }}>
      <input ref={inputRef} inputMode="numeric" pattern="[0-9]*" placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")))} aria-label={label} aria-invalid={invalid || undefined} data-testid={testId} />
      <span className="field-suffix">MI</span>
    </div>
  );
}

function configSummary(t: ReturnType<typeof useT>, config: EquipmentConfig): string {
  const tires = config.axles.reduce((n, a) => n + wheelPositionsOf(a).length, 0);
  const tpl = config.templateKey ? templateByKey(config.templateKey) : undefined;
  const base = t("equipment.configSummary", { axles: config.axles.length, tires, spares: config.spares.length });
  return tpl ? `${t(tpl.labelKey as MessageKey)} · ${base}` : base;
}

interface Props {
  draft: InspectionDraft;
  /** True when readings already exist: the step edits equipment instead of starting fresh. */
  editing: boolean;
  driverName: string;
  /** Components pre-selected from the driver's last inspection on this device (convenience only). */
  remembered?: boolean;
  onApply: (selection: EquipmentSelection) => void;
  onCancel: () => void;
  onChangeDriver: () => void;
}

const EXTRA_SLOTS: ComponentSlot[] = ["jeep", "dolly", "booster", "trailer2"];

/** "What are you inspecting?" (design §1a step 2), with Add equipment for unusual combinations and explicit validation. */
export function EquipmentStep({ draft, editing, driverName, remembered, onApply, onCancel, onChangeDriver }: Props) {
  const t = useT();
  const [components, setComponents] = useState<DraftComponent[]>(draft.components);
  const [odometer, setOdometer] = useState<number | null>(draft.odometer);
  const [hubometer, setHubometer] = useState<number | null>(draft.hubometer);
  const [issues, setIssues] = useState<EquipmentIssue[]>([]);
  const [addOpen, setAddOpen] = useState(components.some((c) => EXTRA_SLOTS.includes(c.slot)));
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const odoRef = useRef<HTMLInputElement>(null);
  const pickerRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const noticeRef = useRef<HTMLDivElement>(null);
  const mode = baseModeOf(components);

  const setMode = (m: BaseMode) => {
    setIssues([]);
    setComponents(componentsForMode({ ...draft, components }, m));
  };
  const setComponent = (slot: ComponentSlot, patch: Partial<DraftComponent>) => setComponents((cs) => cs.map((c) => (c.slot === slot ? { ...c, ...patch } : c)));
  const remove = (slot: ComponentSlot) => setComponents((cs) => cs.filter((c) => c.slot !== slot));
  const add = (slot: ComponentSlot) => setComponents((cs) => (cs.some((c) => c.slot === slot) ? cs : [...cs, emptyComponent(slot)]));

  const pick = async (slot: ComponentSlot, asset: DraftAsset | null) => {
    setIssues([]);
    if (!asset) {
      setComponent(slot, { asset: null, config: null, configurationId: null, configVersion: null, mounted: undefined });
      return;
    }
    setComponent(slot, { asset, config: null, configurationId: null, configVersion: null, mounted: undefined });
    setLoading((l) => ({ ...l, [slot]: true }));
    try {
      const data = await apiJson<{ equipment: DriverEquipment }>(`/api/driver/equipment?assetId=${asset.id}`);
      setComponent(slot, { asset, config: data.equipment.config, configurationId: data.equipment.configurationId, configVersion: data.equipment.configVersion, mounted: data.equipment.mounted });
    } catch {
      // Offline: the kind's default template applies; the server re-resolves the configuration at submission.
      setComponent(slot, { asset, config: defaultConfigFor(SLOT_KIND[slot]), configurationId: null, configVersion: null });
    } finally {
      setLoading((l) => ({ ...l, [slot]: false }));
    }
  };

  const start = () => {
    const found = equipmentIssues(components.map((c) => ({ slot: c.slot, kind: c.kind, assetId: c.asset?.id ?? null })), odometer);
    setIssues(found);
    if (found.length) {
      const first = found[0];
      window.setTimeout(() => {
        if (first.code === "odometer_required") odoRef.current?.focus();
        else if (first.code === "asset_required") pickerRefs.current[first.slot]?.focus();
        (first.code === "no_equipment" ? noticeRef.current : null)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 0);
      return;
    }
    onApply({ components, odometer, hubometer });
  };

  const issueText = (i: EquipmentIssue) => {
    if (i.code === "no_equipment") return t("equipment.errors.noEquipment");
    const c = components.find((x) => x.slot === i.slot);
    const kind = c ? t(`equipment.kinds.${c.kind}` as MessageKey) : "";
    return i.code === "odometer_required" ? t("equipment.errors.odometerRequired") : t("equipment.errors.assetRequired", { kind });
  };
  const has = (slot: string, code: EquipmentIssue["code"]) => issues.some((i) => i.code === code && "slot" in i && i.slot === slot);

  const modes: Array<[BaseMode, string]> = [
    ["truck", t("equipment.truck")],
    ["trailer", t("equipment.trailer")],
    ["truck_trailer", t("equipment.both")],
  ];
  const extras = components.filter((c) => EXTRA_SLOTS.includes(c.slot));
  const cardFor = (c: DraftComponent) => {
    const kindLabel = c.slot === "trailer2" ? `${t("equipment.trailer")} 2` : c.kind === "truck" ? t("design.tractor") : t(`equipment.kinds.${c.kind}` as MessageKey);
    const extra = EXTRA_SLOTS.includes(c.slot);
    return (
      <div key={c.slot} className="card-sm" style={{ marginTop: 14, padding: 16 }} data-component={c.slot}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="label">{kindLabel}{remembered && c.asset && !editing ? <span className="chip-mono" style={{ marginLeft: 8, background: "var(--indigo-soft)", color: "var(--indigo)", fontSize: 10 }}>{t("equipment.lastUsed")}</span> : null}</div>
          {extra ? (
            <button type="button" className="a-link" style={{ color: "var(--st-crit)" }} onClick={() => remove(c.slot)}>
              {t("equipment.remove")}
            </button>
          ) : null}
        </div>
        <AssetPicker kind={c.kind} value={c.asset} onPick={(a) => void pick(c.slot, a)} invalid={has(c.slot, "asset_required")} inputRef={(el) => { pickerRefs.current[c.slot] = el; }} />
        {has(c.slot, "asset_required") ? <div style={{ marginTop: 6, font: "600 12px/1.4 var(--font-sans)", color: "var(--st-crit)" }} role="alert" data-testid={`error-${c.slot}`}>{t("equipment.errors.assetRequired", { kind: t(`equipment.kinds.${c.kind}` as MessageKey) })}</div> : null}
        {c.asset ? (
          <div style={{ marginTop: 8, font: "500 11.5px/1.4 var(--font-sans)", color: "var(--muted)" }} data-testid={`config-${c.slot}`}>
            {loading[c.slot] ? t("app.loading") : configSummary(t, c.config ?? defaultConfigFor(c.kind))}
            {!loading[c.slot] && !c.configurationId ? ` · ${t("equipment.defaultConfig")}` : ""}
          </div>
        ) : null}
        {c.kind === "truck" ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ font: "600 12px/1 var(--font-sans)", color: "var(--text-2)", letterSpacing: ".02em" }}>
              {t("equipment.odometer")} <span style={{ color: "var(--st-crit)" }}>{t("app.required")}</span>
            </div>
            <MiField value={odometer} onChange={(v) => { setIssues((is) => is.filter((i) => i.code !== "odometer_required")); setOdometer(v); }} placeholder="000000" testId="odometer" label={t("equipment.odometer")} invalid={has(c.slot, "odometer_required")} inputRef={odoRef} />
            {has(c.slot, "odometer_required") ? <div style={{ marginTop: 6, font: "600 12px/1.4 var(--font-sans)", color: "var(--st-crit)" }} role="alert" data-testid="error-odometer">{t("equipment.errors.odometerRequired")}</div> : null}
          </div>
        ) : null}
        {c.slot === "trailer" ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ font: "600 12px/1 var(--font-sans)", color: "var(--text-2)" }}>
              {t("equipment.hubometer")} <span style={{ color: "var(--muted)", fontWeight: 500 }}>{t("app.optional")}</span>
            </div>
            <MiField value={hubometer} onChange={setHubometer} placeholder="000000" testId="hubometer" label={t("equipment.hubometer")} />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="scr mx-auto w-full max-w-lg flex-1 overflow-auto" style={{ padding: "18px 20px 20px", minHeight: 0 }}>
        <div className="unit-row" style={{ marginBottom: 16 }} data-testid="driver-banner">
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--st-ok)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0, font: "600 13px/1.3 var(--font-sans)", color: "var(--ink)" }}>{t("driver.continuingAs", { name: driverName })}</div>
          <button type="button" className="a-link" onClick={onChangeDriver} data-testid="change-driver">
            {t("driver.changeDriver")}
          </button>
        </div>
        <div className="h2">{editing ? t("equipment.editTitle") : t("equipment.title")}</div>
        {editing ? <p className="sub" style={{ marginTop: 6 }}>{t("equipment.editHint")}</p> : remembered ? <p className="sub" style={{ marginTop: 6 }} data-testid="remembered-hint">{t("equipment.remembered")}</p> : null}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
          {modes.map(([m, label]) => (
            <button key={m} type="button" className="mode-btn" data-active={mode === m} data-mode={m} onClick={() => setMode(m)}>
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

        {issues.length ? (
          <div ref={noticeRef} className="notice" data-status="red" style={{ marginTop: 14, display: "block" }} role="alert" data-testid="equipment-errors">
            <div style={{ font: "700 12.5px/1.4 var(--font-sans)" }}>{t("equipment.errors.title")}</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, font: "500 12.5px/1.5 var(--font-sans)" }}>
              {issues.map((i, k) => (
                <li key={k}>{issueText(i)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {components.filter((c) => !EXTRA_SLOTS.includes(c.slot)).map(cardFor)}
        {extras.map(cardFor)}

        <div style={{ marginTop: 16 }}>
          <button type="button" className="dashed-btn" onClick={() => setAddOpen((o) => !o)} data-testid="add-equipment">
            {addOpen ? t("equipment.addHide") : t("equipment.add")}
          </button>
          {addOpen ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
              {EXTRA_SLOTS.filter((s) => !components.some((c) => c.slot === s)).map((s) => (
                <button key={s} type="button" className="chip-btn" onClick={() => add(s)} data-testid={`add-${s}`}>
                  + {s === "trailer2" ? `${t("equipment.trailer")} 2` : t(`equipment.kinds.${SLOT_KIND[s]}` as MessageKey)}
                </button>
              ))}
              <span style={{ font: "500 11.5px/1.6 var(--font-sans)", color: "var(--muted)", width: "100%" }}>{t("equipment.addHint")}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ flex: "none", padding: "14px 20px calc(26px + var(--safe-bottom))", display: "flex", gap: 10 }} className="mx-auto w-full max-w-lg">
        <button type="button" className="btn-secondary" style={{ width: 70 }} onClick={onCancel}>
          {editing ? t("app.cancel") : t("app.back")}
        </button>
        <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={start} data-testid="start-inspection">
          {editing ? t("equipment.continue") : t("equipment.start")}
        </button>
      </div>
    </>
  );
}
