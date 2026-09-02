"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import type { DraftTire } from "@/lib/inspection/draft";
import type { StoredPhoto } from "@/lib/offline/db";
import { AXLES, getPosition } from "@/lib/tires/layout";
import { DEFAULT_THRESHOLDS, psiStatus, treadStatus, worstStatus } from "@/lib/tires/thresholds";
import type { TireEvaluation } from "@/lib/tires/types";

interface Props {
  tire: DraftTire;
  evaluation: TireEvaluation;
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

/**
 * Keypad bottom sheet from the design (§1a): PSI and TREAD reading fields,
 * limit hint, Mark damaged / Add photo, photo-required notice, damage type
 * chips, optional brand/model/size, 3×4 keypad and Save. Readings typed on
 * the keypad are committed on Save or when the sheet closes.
 */
export function TireSheet({ tire, photos, analyzing, onChange, onAddPhotos, onRemovePhoto, onClose }: Props) {
  const t = useT();
  const pos = getPosition(tire.number);
  const axle = AXLES.find((a) => a.key === pos.axleKey);
  const isSpare = pos.positionClass === "spare";
  const cls = (isSpare ? "drive" : pos.positionClass) as "steer" | "drive" | "trailer";
  const rule = DEFAULT_THRESHOLDS.psi[cls];

  const [field, setField] = useState<"psi" | "tread">(isSpare ? "tread" : "psi");
  const [psiDraft, setPsiDraft] = useState(tire.psi === null ? "" : String(tire.psi));
  const [treadDraft, setTreadDraft] = useState(tire.tread32 === null ? "" : String(tire.tread32));
  const [detailsOpen, setDetailsOpen] = useState(!!(tire.tireMake || tire.tireModel || tire.tireSize));
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const psiV = psiDraft === "" ? null : Number(psiDraft);
  const treadV = treadDraft === "" ? null : Math.round(Number(treadDraft));
  const ps = isSpare ? "none" : psiStatus(psiV, pos.positionClass);
  const ts = treadStatus(treadV, pos.positionClass);
  const worst = tire.damage === "non_repairable" ? "red" : worstStatus(ps, ts, tire.damage === "repairable" ? "yellow" : "none");
  const needPhoto = !tire.absent && (tire.damage !== "none" || ts === "yellow" || ts === "red") && photos.length === 0;

  const commit = () => onChange({ psi: isSpare ? null : psiV, tread32: treadV });
  const close = () => {
    commit();
    onClose();
  };

  const press = (k: string) => {
    const set = field === "psi" ? setPsiDraft : setTreadDraft;
    const v = field === "psi" ? psiDraft : treadDraft;
    if (k === "⌫") set(v.slice(0, -1));
    else if (k === ".") {
      if (field === "psi" && v.length && !v.includes(".")) set(v + ".");
    } else if (v.replace(".", "").length < (field === "psi" ? 5 : 2)) set(v + k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (/^[0-9]$/.test(e.key) || e.key === "." || e.key === "Backspace") press(e.key === "Backspace" ? "⌫" : e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, psiDraft, treadDraft]);


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
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ai = tire.aiSuggestion;
  const showAi = ai && ai.accepted === undefined && ai.tread32 !== null;

  return (
    <>
      <div className="sheet-backdrop" onClick={close} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("tire.title", { number: tire.number })} data-tire-sheet>
        <header style={{ flex: "none", padding: "14px 18px 12px", borderBottom: "1px solid var(--hair-2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span data-status={worst} style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", font: "700 15px/1 var(--font-mono)", background: "var(--s)", color: "#fff" }}>
            {tire.number}
          </span>
          <div style={{ flex: 1 }}>
            <div className="h3">{t("tire.title", { number: tire.number })} · {isSpare ? t("design.sheet.spare") : pos.abbreviation}</div>
            <div style={{ font: "500 11.5px/1.2 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>
              {isSpare ? t("design.treadOnly") : `${axle ? t(axle.labelKey as MessageKey) : ""} · ${t("design.sheet.target", { lo: rule.yellowBelow, hi: rule.redAbove })}`}
            </div>
          </div>
          <button type="button" onClick={close} aria-label={t("app.close")} style={{ width: 38, height: 38, borderRadius: 11, border: "1.5px solid var(--hair)", background: "#fff", color: "var(--text-3)", font: "600 16px/1 var(--font-sans)" }}>
            ✕
          </button>
        </header>

        <div className="scr" style={{ flex: 1, overflow: "auto", padding: "14px 18px 10px" }}>
          {isSpare ? (
            <button type="button" className="toggle-btn" data-tone={tire.absent ? "indigo" : undefined} data-testid="no-spare" role="switch" aria-checked={!!tire.absent} style={{ width: "100%", marginBottom: 10 }} onClick={() => onChange(tire.absent ? { absent: false } : { absent: true, psi: null, tread32: null, damage: "none", damageType: null, aiSuggestion: null })}>
              {tire.absent ? "✓ " : ""}{t("tire.noSpare")}
            </button>
          ) : null}

          {tire.absent ? (
            <p className="sub">{t("tire.noSpareHint")}</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10 }}>
                {!isSpare ? (
                  <button type="button" className="reading-btn" data-active={field === "psi"} onClick={() => setField("psi")} data-testid="field-psi">
                    <span className="label-xs" style={{ display: "block" }}>PSI</span>
                    <span className="v" style={{ display: "block" }}>{psiDraft === "" ? "—" : psiDraft}</span>
                  </button>
                ) : null}
                <button type="button" className="reading-btn" data-active={field === "tread"} onClick={() => setField("tread")} data-testid="field-tread">
                  <span className="label-xs" style={{ display: "block" }}>{t("design.sheet.treadLabel")}</span>
                  <span className="v" style={{ display: "block" }}>{treadDraft === "" ? "—" : treadDraft}</span>
                </button>
              </div>
              <div style={{ font: "500 11.5px/1.4 var(--font-sans)", color: hints.length ? "var(--st-crit)" : "var(--muted)", marginTop: 8, padding: "0 2px" }}>
                {hints.length ? hints.join(" · ") : t("design.sheet.withinLimits")}
              </div>

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
                <button type="button" className="toggle-btn" data-tone={tire.damage !== "none" ? "crit" : undefined} data-testid="mark-damaged" onClick={() => onChange(tire.damage === "none" ? { damage: "repairable" } : { damage: "none", damageType: null })}>
                  {tire.damage !== "none" ? "✓ " + t("design.sheet.damaged") : t("design.sheet.markDamaged")}
                </button>
                <button type="button" className="toggle-btn" data-tone={photos.length ? "indigo" : needPhoto ? "need" : undefined} disabled={busy} onClick={() => cameraRef.current?.click()} data-testid="add-photo">
                  <span style={{ width: 18, height: 14, borderRadius: 3, border: "2px solid currentColor", display: "inline-block" }} />
                  {busy ? "…" : photos.length ? t("design.sheet.photoAdded") : t("tire.addPhoto")}
                </button>
              </div>

              {needPhoto ? (
                <div className="notice" data-status="red" style={{ marginTop: 10 }}>
                  <span className="bang">!</span>
                  <div style={{ flex: 1, font: "600 12.5px/1.4 var(--font-sans)" }}>
                    {tire.damage === "non_repairable" ? t("design.sheet.photoReqOos") : tire.damage !== "none" ? t("design.sheet.photoReqDamaged") : t("design.sheet.photoReqLow")}
                    <span style={{ display: "block", fontWeight: 500, color: "var(--text-3)", marginTop: 3 }}>{t("design.sheet.photoSuggest")}</span>
                  </div>
                </div>
              ) : null}

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
                    <button type="button" className="a-link" style={{ display: "block", marginTop: 2 }} onClick={() => fileRef.current?.click()}>
                      + {t("design.sheet.gallery")}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="a-link" style={{ marginTop: 8, display: "block" }} onClick={() => fileRef.current?.click()}>
                  {t("design.sheet.gallery")}
                </button>
              )}

              <button type="button" className="dashed-btn" style={{ marginTop: 14 }} onClick={() => setDetailsOpen((o) => !o)}>
                {detailsOpen ? t("design.sheet.detailsHide") : t("design.sheet.detailsAdd")}
              </button>
              {detailsOpen ? (
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ gridColumn: "span 2" }}>
                    <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("design.sheet.brand")}</div>
                    <input className="text-input" style={{ marginTop: 6 }} placeholder="e.g. Michelin" value={tire.tireMake ?? ""} onChange={(e) => onChange({ tireMake: e.target.value })} />
                  </div>
                  <div>
                    <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.model")}</div>
                    <input className="text-input" style={{ marginTop: 6 }} placeholder="X Line" value={tire.tireModel ?? ""} onChange={(e) => onChange({ tireModel: e.target.value })} />
                  </div>
                  <div>
                    <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.size")}</div>
                    <input className="text-input mono" style={{ marginTop: 6 }} placeholder="295/75R22.5" value={tire.tireSize ?? ""} onChange={(e) => onChange({ tireSize: e.target.value })} />
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <div className="label-xs" style={{ letterSpacing: ".06em" }}>{t("tire.notes")}</div>
                    <textarea className="textarea" style={{ marginTop: 6, minHeight: 56 }} value={tire.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
                  </div>
                </div>
              ) : null}
            </>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
        </div>

        <div className="tray" style={{ flex: "none" }}>
          {!tire.absent ? (
            <div className="keypad">
              {KEYS.map((k) => (
                <button key={k} type="button" className="key" data-tone={k === "⌫" ? "dim" : undefined} disabled={k === "." && field === "tread"} style={k === "." && field === "tread" ? { opacity: 0.35 } : undefined} onClick={() => press(k)} data-key={k}>
                  {k}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: tire.absent ? 0 : 9 }}>
            {!isSpare && !tire.absent ? (
              <button type="button" className="btn-secondary" style={{ width: 104, height: 54, borderRadius: 14, font: "700 14px/1 var(--font-sans)" }} onClick={() => setField(field === "psi" ? "tread" : "psi")}>
                {field === "psi" ? t("design.sheet.nextTread") : t("design.sheet.nextPsi")}
              </button>
            ) : null}
            <button type="button" className="btn-primary" style={{ height: 54, borderRadius: 14, font: "700 16px/1 var(--font-sans)" }} onClick={close} data-testid="save-tire">
              {t("design.sheet.saveTire", { number: tire.number })}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
