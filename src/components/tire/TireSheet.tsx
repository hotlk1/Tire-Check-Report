"use client";

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { Button, Label, StatusBadge } from "@/components/ui";
import type { DraftTire } from "@/lib/inspection/draft";
import type { StoredPhoto } from "@/lib/offline/db";
import { AXLES, getPosition } from "@/lib/tires/layout";
import type { MessageKey } from "@/i18n";
import type { DamageStatus, TireEvaluation } from "@/lib/tires/types";
import { PhotoCapture } from "./PhotoCapture";

interface Props {
  tire: DraftTire;
  evaluation: TireEvaluation;
  photos: StoredPhoto[];
  analyzing?: boolean;
  onChange: (patch: Partial<DraftTire>) => void;
  onAddPhotos: (files: FileList) => Promise<void>;
  onRemovePhoto: (photoId: string) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const TREAD_QUICK = [2, 4, 6, 8, 10, 12, 14, 16, 18];

function parseNum(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-tire editing sheet (bottom sheet on mobile, side panel on desktop).
 * Large numeric inputs, tread quick-chips, damage segmented control, photos,
 * optional tire details and the assistive AI suggestion banner.
 */
export function TireSheet({ tire, evaluation, photos, analyzing, onChange, onAddPhotos, onRemovePhoto, onClose, onPrev, onNext }: Props) {
  const t = useT();
  const pos = getPosition(tire.number);
  const axle = AXLES.find((a) => a.key === pos.axleKey);
  const [psiText, setPsiText] = useState(tire.psi === null ? "" : String(tire.psi));
  const [treadText, setTreadText] = useState(tire.tread32 === null ? "" : String(tire.tread32));
  const [showDetails, setShowDetails] = useState(!!(tire.tireMake || tire.tireModel || tire.tireSize || tire.notes));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ai = tire.aiSuggestion;
  const showAi = ai && ai.accepted === undefined && ai.tread32 !== null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t("tire.title", { number: tire.number })} data-tire-sheet>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong md:hidden" />
        <header className="flex items-center gap-3 px-4 pb-2 pt-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-brand text-lg font-bold text-white" data-status={evaluation.overall} style={{ boxShadow: "0 0 0 3px var(--s)" }}>
            {tire.number}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold leading-tight">{t(pos.labelKey as MessageKey)}</div>
            <div className="text-[12px] text-text-3">
              {pos.abbreviation}
              {axle ? ` · ${t(axle.labelKey as MessageKey)}` : ""}
            </div>
          </div>
          <StatusBadge status={evaluation.overall}>{t(`tire.status.${evaluation.overall}`)}</StatusBadge>
          <button type="button" onClick={onClose} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:bg-surface-3" aria-label={t("app.close")}>
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className={"grid gap-3 " + (pos.requiresPsi ? "grid-cols-2" : "grid-cols-1")}>
            {pos.requiresPsi ? (
              <div>
                <Label hint={evaluation.psiStatus !== "none" ? t(`tire.status.${evaluation.psiStatus}`) : undefined}>{t("tire.psi")}</Label>
                <input
                  className="num-input"
                  data-status={evaluation.psiStatus}
                  inputMode="decimal"
                  pattern="[0-9]*"
                  placeholder="—"
                  value={psiText}
                  autoFocus={tire.psi === null}
                  onChange={(e) => {
                    setPsiText(e.target.value);
                    onChange({ psi: parseNum(e.target.value) });
                  }}
                  aria-label={t("tire.psi")}
                />
              </div>
            ) : null}
            <div>
              <Label hint={evaluation.treadStatus !== "none" ? t(`tire.status.${evaluation.treadStatus}`) : t("tire.tread32")}>{t("tire.tread")}</Label>
              <input
                className="num-input"
                data-status={evaluation.treadStatus}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="—"
                value={treadText}
                autoFocus={!pos.requiresPsi && tire.tread32 === null}
                onChange={(e) => {
                  setTreadText(e.target.value);
                  const n = parseNum(e.target.value);
                  onChange({ tread32: n === null ? null : Math.round(n) });
                }}
                aria-label={t("tire.tread")}
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TREAD_QUICK.map((v) => (
              <button
                key={v}
                type="button"
                className="quick-chip"
                data-active={tire.tread32 === v}
                onClick={() => {
                  setTreadText(String(v));
                  onChange({ tread32: v });
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {showAi ? (
            <div className="mt-3 flex items-center gap-2 rounded-[var(--radius)] border border-accent/30 bg-accent-soft px-3 py-2 text-[13px]">
              <span className="flex-1 font-semibold text-accent">
                {t("tire.aiEstimate", { value: ai.tread32 ?? "–", confidence: Math.round((ai.confidence ?? 0) * 100) })}
              </span>
              <Button
                size="sm"
                type="button"
                onClick={() => {
                  setTreadText(String(ai.tread32));
                  onChange({ tread32: ai.tread32, aiSuggestion: { ...ai, accepted: true } });
                }}
              >
                {t("tire.aiUse")}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => onChange({ aiSuggestion: { ...ai, accepted: false } })}>
                {t("tire.aiIgnore")}
              </Button>
            </div>
          ) : analyzing ? (
            <div className="mt-3 text-[12px] text-text-3">{t("tire.aiAnalyzing")}</div>
          ) : null}

          <div className="mt-4">
            <Label>{t("tire.damage")}</Label>
            <div className="seg grid-cols-3" role="radiogroup" aria-label={t("tire.damage")}>
              {(
                [
                  ["none", t("tire.damageNone"), undefined],
                  ["repairable", t("tire.damageRepairable"), "yellow"],
                  ["non_repairable", t("tire.damageNonRepairable"), "red"],
                ] as Array<[DamageStatus, string, string | undefined]>
              ).map(([value, label, tone]) => (
                <button key={value} type="button" role="radio" aria-checked={tire.damage === value} data-active={tire.damage === value} data-tone={tone} onClick={() => onChange({ damage: value })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <Label hint={evaluation.photoRequired ? t("app.required") : t("app.optional")}>{t("tire.photos")}</Label>
            <PhotoCapture photos={photos} required={evaluation.photoRequired} onAdd={onAddPhotos} onRemove={onRemovePhoto} />
          </div>

          <div className="mt-4">
            <button type="button" className="flex w-full items-center justify-between py-2 text-[13px] font-semibold text-text-2" onClick={() => setShowDetails((s) => !s)}>
              <span>
                {t("tire.details")} <span className="font-normal text-text-3">({t("app.optional")})</span>
              </span>
              <span>{showDetails ? "▴" : "▾"}</span>
            </button>
            {showDetails ? (
              <div className="grid grid-cols-2 gap-2">
                <input className="h-11 rounded-[var(--radius)] border border-border-strong px-3 text-[15px]" placeholder={t("tire.make")} value={tire.tireMake ?? ""} onChange={(e) => onChange({ tireMake: e.target.value })} />
                <input className="h-11 rounded-[var(--radius)] border border-border-strong px-3 text-[15px]" placeholder={t("tire.model")} value={tire.tireModel ?? ""} onChange={(e) => onChange({ tireModel: e.target.value })} />
                <input className="col-span-2 h-11 rounded-[var(--radius)] border border-border-strong px-3 text-[15px]" placeholder={t("tire.size")} value={tire.tireSize ?? ""} onChange={(e) => onChange({ tireSize: e.target.value })} />
                <textarea className="col-span-2 min-h-[64px] rounded-[var(--radius)] border border-border-strong px-3 py-2 text-[15px]" placeholder={t("tire.notes")} value={tire.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} />
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("tire.prev")}>
            ‹
          </Button>
          <Button className="flex-1" type="button" onClick={onClose}>
            {t("app.done")}
          </Button>
          <Button variant="secondary" type="button" onClick={onNext} disabled={!onNext} aria-label={t("tire.nextTire")}>
            ›
          </Button>
        </footer>
      </div>
    </>
  );
}
