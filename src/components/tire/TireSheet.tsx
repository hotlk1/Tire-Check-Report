"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogPicker } from "./CatalogPicker";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import type { LayoutPosition } from "@/lib/equipment/layout";
import type { DraftTire, MountedTireInfo } from "@/lib/inspection/draft";
import { sanityWarnings, tireSaveIssues, type SanityWarning, type TireSaveIssue } from "@/lib/inspection/validation";
import type { StoredPhoto } from "@/lib/offline/db";
import { INPUT_LIMITS, psiStatus, treadStatus, worstStatus, type ThresholdConfig } from "@/lib/tires/thresholds";
import { evaluateTire } from "@/lib/tires/evaluate";

interface Props {
  tire: DraftTire;
  pos: LayoutPosition;
  /** "Drive axle 2 · Tractor 4182" */
  positionLabel: string;
  config: ThresholdConfig;
  mounted?: MountedTireInfo | null;
  photos: StoredPhoto[];
  analyzing?: boolean;
  onChange: (patch: Partial<DraftTire>) => void;
  onAddPhotos: (files: FileList) => Promise<void>;
  onRemovePhoto: (photoId: string) => void;
  onClose: () => void;
}

const DAMAGE_TYPES = ["air_loss", "sidewall_cut", "irregular_wear", "exposed_cord", "chunking", "bulge"] as const;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

function Thumb({ photo, onRemove }: { photo: StoredPhoto; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(photo.blob), [photo.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div style={{ position: "relative", width: 62, height: 62, borderRadius: 12, overflow: "hidden", border: "1px solid var(--field)", background: "var(--hair-2)", flex: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <button type="button" onClick={onRemove} aria-label="remove" style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: 9, background: "rgba(14,23,41,.7)", color: "#fff", font: "700 10px/1 var(--font-sans)" }}>
        ✕
      </button>
    </div>
  );
}

const ISSUE_KEY: Record<TireSaveIssue["code"], MessageKey> = {
  psi_required: "tire.validation.psiRequired",
  tread_required: "tire.validation.treadRequired",
  photo_required_damaged: "tire.validation.photoRequiredDamaged",
  photo_required_oos: "tire.validation.photoRequiredOos",
  photo_required_tread_threshold: "tire.validation.photoRequiredTreadThreshold",
  photo_required_tread: "tire.validation.photoRequiredTread",
  photo_required_psi: "tire.validation.photoRequiredPsi",
  psi_out_of_range: "tire.validation.psiOutOfRange",
  tread_out_of_range: "tire.validation.treadOutOfRange",
};

/**
 * Keypad bottom sheet from the design (§1a): PSI and TREAD reading fields,
 * limit hint, Mark damaged / Add photo, photo-required notice, damage type
 * chips, brand/model/size (pre-filled from the mounted tire), 3×4 keypad
 * and Save. Save validates explicitly: every missing input is named, the
 * field is highlighted and focused, and unusual readings ask for
 * confirmation. The draft autosaves regardless; "Keep as draft" closes an
 * incomplete tire without marking it complete.
 */
export function TireSheet({ tire, pos, positionLabel, config, mounted, photos, analyzing, onChange, onAddPhotos, onRemovePhoto, onClose }: Props) {
  const t = useT();
  const isSpare = pos.isSpare;
  const rule = config.psi[pos.positionClass];

  const [field, setField] = useState<"psi" | "tread">(isSpare ? "tread" : "psi");
  const [psiDraft, setPsiDraft] = useState(tire.psi === null ? "" : String(tire.psi));
  const [treadDraft, setTreadDraft] = useState(tire.tread32 === null ? "" : String(tire.tread32));
  const [detailsOpen, setDetailsOpen] = useState(!!(tire.tireMake || tire.tireModel || tire.tireSize));
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<TireSaveIssue[] | null>(null);
  const [warnings, setWarnings] = useState<SanityWarning[] | null>(null);
  /** Pending brand/model/size change that differs from the mounted tire; the driver must say replace or correct. */
  const [identityPending, setIdentityPending] = useState<{ tireVariantId: string | null; tireMake: string; tireModel: string; tireSize: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  // Re-opening a tire shows its saved readings; the first key typed into a field replaces the value instead of appending.
  const replaceNext = useRef<{ psi: boolean; tread: boolean }>({ psi: tire.psi !== null, tread: tire.tread32 !== null });

  const psiV = psiDraft === "" ? null : Number(psiDraft);
  const treadV = treadDraft === "" ? null : Math.round(Number(treadDraft));
  const ps = isSpare && psiV === null ? "none" : psiStatus(psiV, pos.positionClass, config);
  const ts = treadStatus(treadV, pos.positionClass, config);
  const worst = tire.damage === "non_repairable" ? "red" : worstStatus(ps, ts, tire.damage === "repairable" ? "yellow" : "none");
  const reading = { key: pos.key, number: pos.number, psi: psiV, tread32: treadV, damage: tire.damage, photoCount: photos.length };
  const live = evaluateTire(reading, pos, config);
  const needPhoto = live.photoMissing;
  const photoThreshold = config.photoPolicy.treadBelow32[pos.positionClass];
  const photoReasonText = live.photoReason === "oos" ? t("design.sheet.photoReqOos") : live.photoReason === "damaged" ? t("design.sheet.photoReqDamaged") : live.photoReason === "tread_threshold" ? t("tire.validation.photoRequiredTreadThreshold", { v: photoThreshold ?? "" }) : live.photoReason === "tread_status" ? t("design.sheet.photoReqLow") : t("design.sheet.photoReqPsi");

  const commit = () => onChange({ psi: psiV, tread32: treadV });
  const closeAsDraft = () => {
    commit();
    onClose();
  };

  const save = () => {
    const found = tireSaveIssues(reading, pos, config);
    if (found.length) {
      commit();
      setIssues(found);
      setWarnings(null);
      const first = found[0];
      if (first.field === "psi" || first.field === "tread") setField(first.field);
      window.setTimeout(() => (first.field === "photo" ? photoRef.current : errorRef.current)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
      return;
    }
    const catalog = mounted && tire.tireAssetId === mounted.tireAssetId ? { originalTread32: mounted.originalTread32 ?? null, maxColdPsi: mounted.maxColdPsi ?? null } : null;
    const warn = tire.confirmedUnusual ? [] : sanityWarnings(reading, catalog);
    if (warn.length) {
      commit();
      setIssues(null);
      setWarnings(warn);
      return;
    }
    commit();
    onClose();
  };

  const press = (k: string) => {
    const set = field === "psi" ? setPsiDraft : setTreadDraft;
    const replace = replaceNext.current[field];
    replaceNext.current[field] = false;
    const v = replace && k !== "⌫" ? "" : field === "psi" ? psiDraft : treadDraft;
    setIssues(null);
    setWarnings(null);
    if (k === "⌫") set(v.slice(0, -1));
    else if (k === ".") {
      if (field === "psi" && v.length && !v.includes(".")) set(v + ".");
    } else if (v.replace(".", "").length < (field === "psi" ? 5 : 2)) set(v + k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAsDraft();
      else if (e.key === "Enter") save();
      else if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === "Backspace") press(e.key === "Backspace" ? "⌫" : e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, psiDraft, treadDraft, tire, photos.length]);

  const hints: string[] = [];
  if (ps === "red") hints.push(psiV !== null && psiV < rule.redBelow ? t("design.sheet.limitPsiLow", { v: rule.redBelow }) : t("design.sheet.limitPsiHigh", { v: rule.redAbove }));
  else if (ps === "yellow") hints.push(t("design.sheet.limitPsiWarn"));
  if (ts === "red") hints.push(t("design.sheet.limitTreadCrit"));
  else if (ts === "yellow") hints.push(t("design.sheet.limitTreadWarn"));

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await onAddPhotos(files);
      setIssues((cur) => (cur ? cur.filter((i) => i.field !== "photo") : cur));
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ai = tire.aiSuggestion;
  const showAi = ai && ai.accepted === undefined && ai.tread32 !== null;
  const invalid = (f: "psi" | "tread") => !!issues?.some((i) => i.field === f);
  const mountedLabel = mounted ? [mounted.tireMake, mounted.tireModel, mounted.tireSize].filter(Boolean).join(" ") : "";
  const warningText = (w: SanityWarning) => {
    switch (w.code) {
      case "tread_above_original": return t("tire.sanity.treadAboveOriginal", { v: treadV ?? "", original: w.original });
      case "tread_unusually_high": return t("tire.sanity.treadHigh", { v: treadV ?? "" });
      case "psi_above_max_cold": return t("tire.sanity.psiAboveMax", { v: psiV ?? "", max: w.max });
      case "psi_unusually_high": return t("tire.sanity.psiHigh", { v: psiV ?? "" });
      case "psi_unusually_low": return t("tire.sanity.psiLow", { v: psiV ?? "" });
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={closeAsDraft} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("tire.title", { number: pos.number })} data-tire-sheet>
        <header style={{ flex: "none", padding: "14px 18px 12px", borderBottom: "1px solid var(--hair-2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span data-status={worst} style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", font: "700 15px/1 var(--font-mono)", background: "var(--s)", color: "#fff" }}>
            {pos.number}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h3">{t("tire.title", { number: pos.number })} · {isSpare ? t("design.sheet.spare") : pos.abbreviation}</div>
            <div style={{ font: "500 11.5px/1.2 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>
              {positionLabel}{isSpare ? ` · ${t("tire.spareOptional")}` : ` · ${t("design.sheet.target", { lo: rule.yellowBelow, hi: rule.redAbove })}`}
            </div>
          </div>
          <button type="button" onClick={closeAsDraft} aria-label={t("app.close")} style={{ width: 38, height: 38, borderRadius: 11, border: "1.5px solid var(--hair)", background: "#fff", color: "var(--text-3)", font: "600 16px/1 var(--font-sans)" }}>
            ✕
          </button>
        </header>

        <div className="scr" style={{ flex: 1, overflow: "auto", padding: "14px 18px 10px" }}>
          {mountedLabel ? (
            <div style={{ font: "500 11.5px/1.4 var(--font-sans)", color: "var(--muted)", marginBottom: 8 }} data-testid="mounted-tire">
              {t("tire.mountedTire", { label: mountedLabel })}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="reading-btn" data-active={field === "psi"} data-invalid={invalid("psi")} onClick={() => setField("psi")} data-testid="field-psi" style={invalid("psi") ? { boxShadow: "0 0 0 2px var(--st-crit)" } : undefined}>
              <span className="label-xs" style={{ display: "block" }}>PSI{isSpare ? ` · ${t("app.optional")}` : ""}</span>
              <span className="v" style={{ display: "block" }}>{psiDraft === "" ? "—" : psiDraft}</span>
            </button>
            <button type="button" className="reading-btn" data-active={field === "tread"} data-invalid={invalid("tread")} onClick={() => setField("tread")} data-testid="field-tread" style={invalid("tread") ? { boxShadow: "0 0 0 2px var(--st-crit)" } : undefined}>
              <span className="label-xs" style={{ display: "block" }}>{t("design.sheet.treadLabel")}</span>
              <span className="v" style={{ display: "block" }}>{treadDraft === "" ? "—" : treadDraft}</span>
            </button>
          </div>
          <div style={{ font: "500 11.5px/1.4 var(--font-sans)", color: hints.length ? "var(--st-crit)" : "var(--muted)", marginTop: 8, padding: "0 2px" }}>
            {hints.length ? hints.join(" · ") : t("design.sheet.withinLimits")}
          </div>

          {issues?.length ? (
            <div ref={errorRef} className="notice" data-status="red" style={{ marginTop: 10, display: "block" }} role="alert" data-testid="tire-errors">
              <div style={{ font: "700 12.5px/1.4 var(--font-sans)" }}>{t("tire.validation.title")}</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, font: "500 12.5px/1.5 var(--font-sans)" }}>
                {issues.map((i) => (
                  <li key={i.code}>{t(ISSUE_KEY[i.code], { min: i.field === "psi" ? INPUT_LIMITS.psi.min : INPUT_LIMITS.tread32.min, max: i.field === "psi" ? INPUT_LIMITS.psi.max : INPUT_LIMITS.tread32.max, v: photoThreshold ?? "" })}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {warnings?.length ? (
            <div className="notice" data-status="yellow" style={{ marginTop: 10, display: "block" }} role="alert" data-testid="tire-warnings">
              {warnings.map((w) => (
                <div key={w.code} style={{ font: "600 12.5px/1.4 var(--font-sans)" }}>{warningText(w)}</div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" className="chip-btn" data-active onClick={() => { onChange({ psi: psiV, tread32: treadV, confirmedUnusual: true }); onClose(); }} data-testid="confirm-unusual">
                  {t("tire.sanity.keep")}
                </button>
                <button type="button" className="chip-btn" onClick={() => setWarnings(null)}>
                  {t("tire.sanity.recheck")}
                </button>
              </div>
            </div>
          ) : null}

          {showAi ? (
            <div className="notice" data-status="none" style={{ marginTop: 10, background: "var(--indigo-soft)", borderColor: "#cdd3f3", color: "var(--indigo)" }}>
              <span style={{ flex: 1, font: "600 12.5px/1.4 var(--font-sans)" }}>{t("tire.aiEstimate", { value: ai.tread32 ?? "–", confidence: Math.round((ai.confidence ?? 0) * 100) })}</span>
              <button type="button" className="a-link" onClick={() => { setTreadDraft(String(ai.tread32)); onChange({ tread32: ai.tread32, aiSuggestion: { ...ai, accepted: true } }); }}>{t("tire.aiUse")}</button>
              <button type="button" className="a-link" style={{ color: "var(--muted)" }} onClick={() => onChange({ aiSuggestion: { ...ai, accepted: false } })}>{t("tire.aiIgnore")}</button>
            </div>
          ) : analyzing ? (
            <div style={{ marginTop: 8, font: "500 12px/1 var(--font-sans)", color: "var(--muted)" }}>{t("tire.aiAnalyzing")}</div>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" className="toggle-btn" data-tone={tire.damage !== "none" ? "crit" : undefined} data-testid="mark-damaged" onClick={() => { setIssues(null); onChange(tire.damage === "none" ? { damage: "repairable" } : { damage: "none", damageType: null }); }}>
              {tire.damage !== "none" ? "✓ " + t("design.sheet.damaged") : t("design.sheet.markDamaged")}
            </button>
            <button ref={photoRef} type="button" className="toggle-btn" data-tone={photos.length ? "indigo" : needPhoto ? "need" : undefined} disabled={busy} onClick={() => cameraRef.current?.click()} data-testid="add-photo" style={invalid("psi") || invalid("tread") ? undefined : issues?.some((i) => i.field === "photo") ? { boxShadow: "0 0 0 2px var(--st-crit)" } : undefined}>
              <span style={{ width: 18, height: 14, borderRadius: 3, border: "2px solid currentColor", display: "inline-block" }} />
              {busy ? "…" : photos.length ? t("design.sheet.photoAdded") : t("tire.addPhoto")}
            </button>
          </div>

          {needPhoto ? (
            <div className="notice" data-status="red" style={{ marginTop: 10 }} data-testid="photo-required">
              <span className="bang">!</span>
              <div style={{ flex: 1, font: "600 12.5px/1.4 var(--font-sans)" }}>
                {photoReasonText}
                <span style={{ display: "block", fontWeight: 500, color: "var(--text-3)", marginTop: 3 }}>{t("design.sheet.photoSuggest")}</span>
              </div>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="toggle-btn" disabled={busy} onClick={() => cameraRef.current?.click()} data-testid="photo-camera">
              📷 {t("tire.photo.camera")}
            </button>
            <button type="button" className="toggle-btn" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="photo-gallery">
              🖼 {t("tire.photo.gallery")}
            </button>
          </div>

          {tire.damage !== "none" ? (
            <div style={{ marginTop: 12 }}>
              <div className="label">{t("design.sheet.damageType")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                {DAMAGE_TYPES.map((d) => (
                  <button key={d} type="button" className="chip-btn" data-active={tire.damageType === d} onClick={() => onChange({ damageType: tire.damageType === d ? null : d })}>
                    {t(`design.damageTypes.${d}`)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                <button type="button" className="chip-btn" data-active={tire.damage === "repairable"} data-tone="indigo" onClick={() => onChange({ damage: "repairable" })}>
                  {t("design.sheet.repairable")}
                </button>
                <button type="button" className="chip-btn" data-active={tire.damage === "non_repairable"} onClick={() => onChange({ damage: "non_repairable" })} data-testid="oos">
                  {t("design.sheet.oos")}
                </button>
              </div>
            </div>
          ) : null}

          {photos.length ? (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", overflowX: "auto" }}>
              {photos.map((p) => (
                <Thumb key={p.id} photo={p} onRemove={() => onRemovePhoto(p.id)} />
              ))}
              <div style={{ font: "500 12px/1.4 var(--font-sans)", color: "var(--text-3)", flex: "none" }}>
                {t("design.sheet.photosAttached", { n: photos.length })}
                <span style={{ display: "block", marginTop: 2 }}>{t("tire.photo.multiple")}</span>
              </div>
            </div>
          ) : null}

          <button type="button" className="dashed-btn" style={{ marginTop: 14 }} data-testid="details-toggle" onClick={() => setDetailsOpen((o) => !o)}>
            {detailsOpen ? t("design.sheet.detailsHide") : mountedLabel ? t("design.sheet.detailsChange") : t("design.sheet.detailsAdd")}
          </button>
          {detailsOpen ? (
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ gridColumn: "span 2" }}>
                <CatalogPicker
                  value={{ tireVariantId: tire.tireVariantId ?? null, tireMake: tire.tireMake, tireModel: tire.tireModel, tireSize: tire.tireSize }}
                  onChange={(sel) => {
                    const same = mounted && ((sel.tireVariantId && sel.tireVariantId === mounted.tireVariantId) || (!sel.tireVariantId && !mounted.tireVariantId && (sel.tireMake ?? "") === (mounted.tireMake ?? "") && (sel.tireModel ?? "") === (mounted.tireModel ?? "") && (sel.tireSize ?? "") === (mounted.tireSize ?? "")));
                    const cleared = !sel.tireVariantId && !sel.tireMake && !sel.tireModel && !sel.tireSize;
                    if (mounted && !same && !cleared && !tire.identityAction) {
                      // Different data than the tire recorded here: ask whether the physical tire changed before deciding.
                      setIdentityPending({ tireVariantId: sel.tireVariantId, tireMake: sel.tireMake ?? "", tireModel: sel.tireModel ?? "", tireSize: sel.tireSize ?? "" });
                      onChange({ tireVariantId: sel.tireVariantId, tireMake: sel.tireMake, tireModel: sel.tireModel, tireSize: sel.tireSize, confirmedUnusual: false });
                      return;
                    }
                    onChange({ tireVariantId: sel.tireVariantId, tireMake: sel.tireMake, tireModel: sel.tireModel, tireSize: sel.tireSize, tireAssetId: same || tire.identityAction === "correct" ? mounted!.tireAssetId : null, identityAction: same ? null : tire.identityAction ?? null, confirmedUnusual: false });
                  }}
                  online={typeof navigator === "undefined" ? true : navigator.onLine}
                />
              </div>
              {identityPending || (tire.identityAction && mounted) ? (
                <div style={{ gridColumn: "span 2" }} className="notice" data-status={identityPending ? "yellow" : "none"} data-testid="identity-prompt">
                  <div style={{ flex: 1 }}>
                    {identityPending ? (
                      <>
                        <div style={{ font: "700 12.5px/1.4 var(--font-sans)" }}>{t("tire.identity.question")}</div>
                        <div style={{ font: "500 12px/1.4 var(--font-sans)", color: "var(--text-3)", marginTop: 2 }}>{t("tire.identity.hint", { label: mountedLabel || "—" })}</div>
                        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                          <button type="button" className="chip-btn" data-active onClick={() => { onChange({ ...identityPending, tireAssetId: null, identityAction: "replace" }); setIdentityPending(null); }} data-testid="identity-replace">{t("tire.identity.replaced")}</button>
                          <button type="button" className="chip-btn" onClick={() => { onChange({ ...identityPending, tireAssetId: mounted!.tireAssetId, identityAction: "correct" }); setIdentityPending(null); }} data-testid="identity-correct">{t("tire.identity.corrected")}</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ font: "600 12px/1.4 var(--font-sans)", color: "var(--text-2)" }}>{tire.identityAction === "replace" ? t("tire.identity.replacedTag") : t("tire.identity.correctedTag")} · {t("tire.identity.hint", { label: mountedLabel || "—" })}</div>
                    )}
                  </div>
                </div>
              ) : null}
              <div style={{ gridColumn: "span 2" }}>
                <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.notes")}</div>
                <textarea className="textarea" style={{ marginTop: 6, minHeight: 56 }} value={tire.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
              </div>
            </div>
          ) : null}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
        </div>

        <div className="tray" style={{ flex: "none" }}>
          <div className="keypad">
            {KEYS.map((k) => (
              <button key={k} type="button" className="key" data-tone={k === "⌫" ? "dim" : undefined} disabled={k === "." && field === "tread"} style={k === "." && field === "tread" ? { opacity: 0.35 } : undefined} onClick={() => press(k)} data-key={k}>
                {k}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
            <button type="button" className="btn-secondary" style={{ width: 104, height: 54, borderRadius: 14, font: "700 14px/1 var(--font-sans)" }} onClick={() => setField(field === "psi" ? "tread" : "psi")}>
              {field === "psi" ? t("design.sheet.nextTread") : t("design.sheet.nextPsi")}
            </button>
            <button type="button" className="btn-primary" style={{ height: 54, borderRadius: 14, font: "700 16px/1 var(--font-sans)" }} onClick={save} data-testid="save-tire">
              {t("design.sheet.saveTire", { number: pos.number })}
            </button>
          </div>
          {issues?.length ? (
            <button type="button" className="a-link" style={{ display: "block", margin: "8px auto 0", color: "var(--muted)" }} onClick={closeAsDraft} data-testid="keep-draft">
              {t("tire.validation.keepDraft")}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
