"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { AppHeader } from "@/components/driver/AppHeader";
import { FeedbackSheet } from "@/components/driver/FeedbackSheet";
import { loadLastEquipment, saveLastEquipment } from "@/lib/driver/memory";
import { TireDiagram } from "@/components/tire/TireDiagram";
import { axleLabel, componentName } from "@/lib/equipment/labels";
import { TireSheet } from "@/components/tire/TireSheet";
import { apiJson } from "@/lib/client/api";
import { useOnline } from "@/lib/client/hooks";
import { axleByKey, type InspectionLayout } from "@/lib/equipment/layout";
import { applyEquipmentChange, baseModeOf, draftHasContent, draftLayout, emptyComponent, emptyTire, isCurrentDraft, isDraftExpired, newDraft, previewEquipmentChange, tireOf, toReadings, type DraftTire, type InspectionDraft } from "@/lib/inspection/draft";
import { buildIssues, verdictOf } from "@/lib/inspection/issues";
import { deleteDraft, deletePhoto, getDraft, listDraftsForDriver, listPhotosForDraft, pruneOldDrafts, saveDraft, savePhoto, type StoredPhoto } from "@/lib/offline/db";
import { prepareImage } from "@/lib/offline/image";
import { startOutboxWatcher, syncDraft } from "@/lib/offline/sync";
import { evaluateInspection } from "@/lib/tires";
import { DEFAULT_THRESHOLDS, type ThresholdConfig } from "@/lib/tires/thresholds";
import { EquipmentStep, type EquipmentSelection } from "./EquipmentStep";
import { ResumePrompt } from "./ResumePrompt";

export interface DriverContext {
  tenantSlug: string;
  tenantName: string;
  driverId: string;
  driverName: string;
}

type Phase = "loading" | "resume" | "equipment" | "inspect" | "review";

/**
 * Driver flow (design §1a): resume/new → equipment → tire diagram → review &
 * submit → submitted. Every change autosaves to IndexedDB; submission goes
 * through the offline outbox. Equipment can be edited at any time; readings
 * for equipment that stays are preserved.
 */
export function InspectionScreen({ ctx }: { ctx: DriverContext }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>("loading");
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [candidate, setCandidate] = useState<InspectionDraft | null>(null);
  const [photos, setPhotos] = useState<Record<string, StoredPhoto>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ inspectionId: string | null; flagged: number } | null>(null);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<{ selection: EquipmentSelection; dropped: ReturnType<typeof previewEquipmentChange> } | null>(null);
  const [highlightIssues, setHighlightIssues] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const issuesRef = useRef<HTMLDivElement>(null);

  /** A fresh draft, pre-selecting the equipment used last time on this device (shown as "Last used", always changeable). */
  const freshDraft = useCallback(() => {
    const d = newDraft(ctx);
    const last = loadLastEquipment(ctx.tenantSlug, ctx.driverId);
    if (last) {
      d.components = last.map((c) => ({ ...emptyComponent(c.slot), kind: c.kind, asset: c.asset }));
      d.mode = baseModeOf(d.components);
      setRemembered(true);
    } else {
      setRemembered(false);
    }
    return d;
  }, [ctx]);

  /** Tenant rules snapshot (thresholds + photo policy) so the client evaluates exactly like the server. */
  const loadRules = useCallback(async (draftId: string) => {
    try {
      const data = await apiJson<{ rules: { id: string; version: number; config: ThresholdConfig } }>("/api/driver/rules");
      setDraft((prev) => {
        if (!prev || prev.id !== draftId) return prev;
        const next = { ...prev, rules: data.rules };
        saveDraft(next).catch(() => {});
        return next;
      });
    } catch {
      /* offline: system defaults until online */
    }
  }, []);

  // ---- load / resume --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await pruneOldDrafts();
        const drafts = (await listDraftsForDriver(ctx.tenantSlug, ctx.driverId)).filter(isCurrentDraft);
        const open = drafts
          .filter((d) => (d.status === "draft" || d.status === "queued" || d.status === "failed") && !isDraftExpired(d) && draftHasContent(d))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        if (cancelled) return;
        if (open[0]) {
          setCandidate(open[0]);
          setPhase("resume");
        } else {
          const d = freshDraft();
          await saveDraft(d);
          setDraft(d);
          setPhase("equipment");
          void loadRules(d.id);
        }
      } catch (e) {
        console.error("draft load failed", e);
        const d = freshDraft();
        setDraft(d);
        setPhase("equipment");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, loadRules, freshDraft]);

  useEffect(() => startOutboxWatcher(), []);

  const loadPhotos = useCallback(async (draftId: string) => {
    const list = await listPhotosForDraft(draftId);
    setPhotos(Object.fromEntries(list.map((p) => [p.id, p])));
  }, []);

  const resume = async () => {
    if (!candidate) return;
    setDraft(candidate);
    await loadPhotos(candidate.id);
    setPhase(candidate.components.some((c) => c.asset) ? "inspect" : "equipment");
    if (!candidate.rules) void loadRules(candidate.id);
  };
  const startNew = async () => {
    if (candidate) await deleteDraft(candidate.id);
    const d = freshDraft();
    await saveDraft(d);
    setDraft(d);
    setPhotos({});
    setSubmitted(null);
    setPhase("equipment");
    void loadRules(d.id);
  };

  // ---- autosave ---------------------------------------------------------------
  const update = useCallback((patch: Partial<InspectionDraft> | ((d: InspectionDraft) => Partial<InspectionDraft>)) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const p = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...p, updatedAt: new Date().toISOString() };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveDraft(next).catch((e) => console.error("autosave failed", e));
      }, 250);
      return next;
    });
  }, []);

  const updateTire = useCallback(
    (key: string, patch: Partial<DraftTire>) => {
      update((d) => ({ tires: { ...d.tires, [key]: { ...tireOf(d, key), ...patch } } }));
    },
    [update],
  );

  // ---- geolocation (never blocks) ------------------------------------------
  const captureLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    update({ locationState: "capturing" });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        update({
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, capturedAt: new Date(pos.timestamp).toISOString() },
          locationState: "captured",
        }),
      () => update({ locationState: "denied" }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, [update]);

  // ---- equipment ---------------------------------------------------------------
  const applySelection = (selection: EquipmentSelection) => {
    if (!draft) return;
    const changed = applyEquipmentChange(draft, selection.components);
    const next = { ...changed.draft, odometer: selection.odometer, hubometer: selection.hubometer };
    setDraft(next);
    saveDraft(next).catch(() => {});
    saveLastEquipment(ctx.tenantSlug, ctx.driverId, next.components.filter((c) => c.asset).map((c) => ({ slot: c.slot, kind: c.kind, asset: c.asset! })));
    setRemembered(false);
    setPendingChange(null);
    setSelected(null);
    setPhase("inspect");
    if (next.locationState === "idle") captureLocation();
  };
  const addSpare = (slot: InspectionLayout["components"][number]["slot"]) => {
    update((d) => ({ components: d.components.map((c) => (c.slot === slot ? { ...c, extraSpares: Math.min(6, (c.extraSpares ?? 0) + 1) } : c)) }));
  };
  const onApplyEquipment = (selection: EquipmentSelection) => {
    if (!draft) return;
    const dropped = previewEquipmentChange(draft, selection.components);
    if (dropped.length) setPendingChange({ selection, dropped });
    else applySelection(selection);
  };

  // ---- photos -----------------------------------------------------------------
  const addPhotos = async (key: string, n: number, files: FileList) => {
    if (!draft) return;
    const ids: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const { blob, width, height } = await prepareImage(file);
        const photo: StoredPhoto = { id: crypto.randomUUID(), draftId: draft.id, tireNumber: n, blob, contentType: "image/jpeg", width, height, createdAt: new Date().toISOString(), uploadedAt: null };
        await savePhoto(photo);
        setPhotos((p) => ({ ...p, [photo.id]: photo }));
        ids.push(photo.id);
      } catch (e) {
        console.error("photo failed", e);
      }
    }
    if (ids.length) {
      updateTire(key, { photoIds: [...tireOf(draft, key).photoIds, ...ids] });
      void analyze(key, n, ids[ids.length - 1]);
    }
  };

  const analyze = async (key: string, n: number, photoId: string) => {
    if (!navigator.onLine || !draft) return;
    const photo = photos[photoId] ?? (await listPhotosForDraft(draft.id)).find((p) => p.id === photoId);
    if (!photo) return;
    setAnalyzing(n);
    try {
      const form = new FormData();
      form.set("file", photo.blob, "photo.jpg");
      form.set("tireNumber", String(n));
      const res = await fetch("/api/ai/analyze-photo", { method: "POST", body: form });
      const data = (await res.json()) as { ok: boolean; available?: boolean; result?: { tread32: number | null; confidence: number | null; defects: string[]; quality: string; provider: string } | null };
      if (data.ok && data.available && data.result && data.result.tread32 !== null) {
        updateTire(key, { aiSuggestion: { ...data.result, photoId } });
      }
    } catch {
      /* assistive only */
    } finally {
      setAnalyzing(null);
    }
  };

  const removePhoto = async (key: string, photoId: string) => {
    if (!draft) return;
    await deletePhoto(photoId);
    setPhotos((p) => {
      const next = { ...p };
      delete next[photoId];
      return next;
    });
    updateTire(key, { photoIds: tireOf(draft, key).photoIds.filter((id) => id !== photoId) });
  };

  // ---- evaluation ----------------------------------------------------------------
  const layout: InspectionLayout | null = useMemo(() => (draft ? draftLayout(draft) : null), [draft]);
  const rules = draft?.rules?.config ?? DEFAULT_THRESHOLDS;
  const readings = useMemo(() => (draft && layout ? toReadings(draft, layout) : {}), [draft, layout]);
  const evaluation = useMemo(() => (layout ? evaluateInspection(layout, readings, rules) : null), [layout, readings, rules]);
  const issues = useMemo(() => (draft && layout ? buildIssues({ layout, readings, odometer: draft.odometer, config: rules }) : []), [draft, layout, readings, rules]);
  const blocking = issues.filter((i) => i.blocking);
  const critical = issues.filter((i) => i.status === "red" && !i.blocking).length;
  const progress = { done: evaluation?.summary.completed ?? 0, total: evaluation?.summary.total ?? 0 };
  const left = progress.total - progress.done;
  const spares = { done: evaluation?.summary.sparesInspected ?? 0, total: evaluation?.summary.spares ?? 0 };

  const openTire = (n: number) => {
    if (!draft || !layout) return;
    const pos = layout.positions.find((p) => p.number === n);
    if (!pos) return;
    const component = draft.components.find((c) => c.slot === pos.slot);
    const localKey = pos.key.slice(pos.slot.length + 1);
    const mounted = component?.mounted?.[localKey];
    // First open of a position with a known mounted tire: carry its identity forward.
    if (!draft.tires[pos.key] && mounted) {
      updateTire(pos.key, { tireMake: mounted.tireMake ?? undefined, tireModel: mounted.tireModel ?? undefined, tireSize: mounted.tireSize ?? undefined, tireVariantId: mounted.tireVariantId, tireAssetId: mounted.tireAssetId });
    }
    setSelected(n);
  };

  // ---- submit ---------------------------------------------------------------------
  const submit = async () => {
    if (!draft || !layout) return;
    if (blocking.length) {
      setHighlightIssues(true);
      issuesRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      window.setTimeout(() => setHighlightIssues(false), 1600);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const queued: InspectionDraft = { ...draft, status: "queued", updatedAt: new Date().toISOString() };
    await saveDraft(queued);
    setDraft(queued);
    const result = await syncDraft(queued);
    const after = (await getDraft(queued.id)) ?? queued;
    setDraft(after);
    setSubmitting(false);
    if (result.ok) setSubmitted({ inspectionId: result.inspectionId, flagged: issues.length });
    else if (result.retryable) setSubmitted({ inspectionId: null, flagged: issues.length });
    else setSubmitError(result.error);
  };

  useEffect(() => {
    if (!draft || draft.status !== "queued" || !submitted || submitted.inspectionId) return;
    const id = window.setInterval(async () => {
      const latest = await getDraft(draft.id);
      if (latest?.inspectionId) setSubmitted((s) => (s ? { ...s, inspectionId: latest.inspectionId } : s));
    }, 3000);
    return () => window.clearInterval(id);
  }, [draft, submitted]);

  const signOut = async () => {
    await fetch("/api/driver/session", { method: "DELETE" });
    router.push(`/t/${ctx.tenantSlug}`);
  };

  const stepLabel = phase === "review" ? t("design.step.review") : phase === "inspect" ? t("design.step.tires") : t("design.step.equipment");
  const header = <AppHeader tenantName={ctx.tenantName} step={stepLabel} progress={phase === "inspect" || phase === "review" ? progress : undefined} right={phase === "equipment" ? <LanguageSwitcher dark /> : undefined} onFeedback={phase === "loading" ? undefined : () => setFeedbackOpen(true)} />;

  const shell = (children: React.ReactNode) => (
    <div className="flex h-dvh flex-col" style={{ background: "var(--bg)", overflow: "hidden" }}>
      {header}
      {!online ? <div style={{ background: "var(--st-warn-tint)", color: "#8a6100", font: "600 12px/1 var(--font-sans)", textAlign: "center", padding: "7px 12px" }}>{t("app.offline")}</div> : null}
      {children}
      {feedbackOpen ? <FeedbackSheet page={`driver/${phase}`} onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  );

  if (phase === "loading" || !draft) {
    return shell(<div className="flex flex-1 items-center justify-center py-20" style={{ color: "var(--muted)" }}>{t("app.loading")}</div>);
  }
  if (phase === "resume" && candidate) return shell(<ResumePrompt draft={candidate} onResume={resume} onStartNew={startNew} />);
  const hasReadings = Object.keys(draft.tires).length > 0;
  if (phase === "equipment" || !layout || !evaluation) {
    return shell(
      <>
        <EquipmentStep key={draft.id + String(hasReadings)} draft={draft} editing={hasReadings} driverName={ctx.driverName} remembered={remembered && !hasReadings} onApply={onApplyEquipment} onCancel={hasReadings && layout ? () => setPhase("inspect") : signOut} onChangeDriver={signOut} />
        {pendingChange ? (
          <>
            <div className="sheet-backdrop" onClick={() => setPendingChange(null)} aria-hidden />
            <div className="sheet" role="dialog" aria-modal="true" style={{ maxHeight: "60vh" }} data-testid="equipment-confirm">
              <div style={{ padding: 20 }}>
                <div className="h3" style={{ fontSize: 17 }}>{t("equipment.changeWarnTitle")}</div>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, font: "500 13.5px/1.6 var(--font-sans)", color: "var(--text-2)" }}>
                  {pendingChange.dropped.map((d) => (
                    <li key={d.slot}>{t("equipment.changeWarnItem", { count: d.count, unit: d.unitNumber ?? t(`equipment.kinds.${draft.components.find((c) => c.slot === d.slot)?.kind ?? "trailer"}` as MessageKey) })}</li>
                  ))}
                </ul>
                <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
                  <button type="button" className="btn-primary" data-tone="ink" onClick={() => applySelection(pendingChange.selection)} data-testid="confirm-equipment-change">
                    {t("equipment.changeWarnConfirm")}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setPendingChange(null)}>
                    {t("app.cancel")}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </>,
    );
  }

  const verdict = verdictOf(issues);
  const verdictInk = verdict === "action" ? "var(--st-crit)" : verdict === "watch" ? "var(--st-warn)" : "var(--st-ok)";
  const isReview = phase === "review";
  const unitsLine = layout.components.map((c) => `${componentName(t, c)} ${c.unitNumber ?? ""}`.trim()).join(" · ");
  const positionLabelOf = (n: number) => {
    const pos = layout.positions.find((p) => p.number === n)!;
    const component = layout.components.find((c) => c.slot === pos.slot)!;
    const axle = axleByKey(layout, pos.axleKey);
    const where = `${componentName(t, component)} ${component.unitNumber ?? ""}`.trim();
    return axle ? `${axleLabel(t, component, axle)} · ${where}` : where;
  };
  const selectedPos = selected !== null ? layout.positions.find((p) => p.number === selected) : undefined;
  const selectedComponent = selectedPos ? draft.components.find((c) => c.slot === selectedPos.slot) : undefined;
  const selectedMounted = selectedPos && selectedComponent?.mounted ? selectedComponent.mounted[selectedPos.key.slice(selectedPos.slot.length + 1)] : undefined;

  return shell(
    <>
      <main className="scr mx-auto w-full max-w-5xl flex-1 overflow-auto" style={{ padding: "14px 14px 24px", minHeight: 0 }}>
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px] md:gap-5">
          <div>
            {isReview ? (
              <div className="card" style={{ padding: "14px 16px", marginBottom: 12, borderRadius: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="h3">{unitsLine}</div>
                    <div style={{ font: "500 11.5px/1.3 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>
                      {ctx.driverName}
                      {draft.odometer !== null ? ` · Odo ${draft.odometer.toLocaleString(locale)} mi` : ""} · {new Date().toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ font: "700 15px/1 var(--font-mono)", color: verdictInk }}>{t(`design.verdict.${verdict}`)}</div>
                    <div className="label-xs" style={{ fontSize: 9.5, marginTop: 2 }}>{t("design.result")}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "0 4px 10px" }}>
                <p style={{ font: "500 12px/1.4 var(--font-sans)", color: "var(--muted)", margin: 0 }}>{t("inspection.tapTire")}</p>
                <button type="button" className="a-link" style={{ flex: "none" }} onClick={() => setPhase("equipment")} data-testid="edit-equipment">
                  {t("equipment.edit")}
                </button>
              </div>
            )}
            <TireDiagram layout={layout} readings={readings} evaluation={evaluation} selected={selected} onSelect={isReview ? undefined : openTire} onAddSpare={isReview ? undefined : addSpare} />
          </div>

          <aside>
            {isReview ? (
              <>
                <div ref={issuesRef} className="card" style={{ marginTop: 12, overflow: "hidden", boxShadow: highlightIssues ? "0 0 0 3px var(--st-crit)" : undefined, transition: "box-shadow .3s" }} data-testid="issues">
                  <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ font: "700 13px/1 var(--font-sans)", color: "var(--ink)", letterSpacing: ".06em", textTransform: "uppercase" }}>{t("design.needsAttention")}</span>
                    <span className="chip-mono" style={{ color: "var(--st-crit)", background: "var(--st-crit-tint)", fontSize: 11 }}>{issues.length}</span>
                  </div>
                  {blocking.length ? <div style={{ padding: "0 16px 10px", font: "600 12.5px/1.4 var(--font-sans)", color: "var(--st-crit)" }} data-testid="blocking-summary">{t("inspection.blockingSummary", { n: blocking.length })}</div> : null}
                  {issues.map((it, k) => {
                    const pos = layout.positions.find((p) => p.number === it.tire)!;
                    return (
                      <button key={k} type="button" onClick={() => { setPhase("inspect"); openTire(it.tire); }} style={{ display: "flex", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--hair-2)", alignItems: "flex-start", width: "100%", textAlign: "left" }} data-status={it.status}>
                        <span style={{ flex: "none", width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", font: "700 12px/1 var(--font-mono)", background: "var(--s-soft)", color: "var(--s)" }}>{it.tire}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "block" }}>
                          <span style={{ display: "block", font: "700 14px/1.2 var(--font-sans)", color: "var(--ink)" }}>
                            {t("tire.title", { number: it.tire })} · {positionLabelOf(it.tire)} {pos.isSpare ? "" : pos.abbreviation}
                          </span>
                          <span style={{ display: "block", font: "500 12px/1.4 var(--font-sans)", color: "var(--text-3)", marginTop: 3 }}>{t(`design.issue.${it.textKey}`, it.params)}</span>
                        </span>
                        <span className="chip" style={{ flex: "none" }}>{t(`design.tags.${it.tag}`)}</span>
                      </button>
                    );
                  })}
                  {issues.length === 0 ? <div style={{ padding: 16, borderTop: "1px solid var(--hair-2)", font: "500 13px/1.4 var(--font-sans)", color: "var(--st-ok)" }}>{t("design.allWithin")}</div> : null}
                </div>
                <div className="card" style={{ marginTop: 12, padding: "14px 16px" }}>
                  <div className="label" style={{ color: "var(--ink)", letterSpacing: ".08em" }}>{t("inspection.notes")}</div>
                  <textarea className="textarea" style={{ marginTop: 9 }} placeholder={t("inspection.notesPlaceholder")} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
                </div>
                {submitError ? <div className="notice" data-status="red" style={{ marginTop: 12 }}><span className="bang">!</span><span style={{ font: "600 12.5px/1.4 var(--font-sans)" }}>{t("app.error")} ({submitError})</span></div> : null}
              </>
            ) : (
              <div style={{ marginTop: 12, font: "500 12px/1.4 var(--font-sans)", color: "var(--muted)", padding: "0 4px" }}>
                {spares.total ? <div>{t("inspection.sparesProgress", { done: spares.done, total: spares.total })}</div> : null}
                {draft.locationState === "capturing" ? t("inspection.locationCapturing") : draft.locationState === "captured" ? "📍 " + t("inspection.locationCaptured") : draft.locationState === "denied" ? t("inspection.locationDenied") : ""}
              </div>
            )}
          </aside>
        </div>
      </main>

      <div style={{ flex: "none", padding: "12px 16px calc(24px + var(--safe-bottom))", background: "linear-gradient(#F6F7FB00,#F6F7FB 34%)", display: "flex", gap: 10 }} className="mx-auto w-full max-w-5xl">
        {isReview ? (
          <>
            <button type="button" className="btn-secondary" style={{ width: 64 }} onClick={() => setPhase("inspect")}>
              {t("design.edit")}
            </button>
            <button type="button" className="btn-primary" data-tone="ink" style={{ flex: 1 }} disabled={submitting} data-blocking={blocking.length > 0} onClick={submit} data-testid="submit">
              {submitting ? t("inspection.submitting") : blocking.length ? t("inspection.fixFirst", { n: blocking.length }) : critical ? t("design.submitCritical", { n: critical }) : t("inspection.submit")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" style={{ width: 96 }} onClick={() => setPhase("equipment")} data-testid="equipment-back">
              {t("equipment.editShort")}
            </button>
            <button type="button" className="btn-primary" data-tone={left > 0 ? "ink" : undefined} style={{ flex: 1 }} onClick={() => setPhase("review")} data-testid="review">
              {left > 0 ? t("design.reviewLeft", { n: left }) : t("design.reviewFull")}
            </button>
          </>
        )}
      </div>

      {selected !== null && selectedPos && !isReview ? (
        <TireSheet
          key={selected}
          tire={draft.tires[selectedPos.key] ?? emptyTire(selectedPos.key)}
          pos={selectedPos}
          positionLabel={positionLabelOf(selected)}
          config={rules}
          mounted={selectedMounted ?? null}
          photos={(draft.tires[selectedPos.key]?.photoIds ?? []).map((id) => photos[id]).filter(Boolean)}
          analyzing={analyzing === selected}
          onChange={(patch) => updateTire(selectedPos.key, patch)}
          onAddPhotos={(files) => addPhotos(selectedPos.key, selected, files)}
          onRemovePhoto={(id) => void removePhoto(selectedPos.key, id)}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {submitted ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--ink)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 40 }} data-testid="submitted">
          <div style={{ width: 76, height: 76, borderRadius: 24, background: "linear-gradient(150deg, var(--indigo), var(--cosmic))", display: "grid", placeItems: "center", font: "700 30px/1 var(--font-sans)", color: "#fff" }}>✓</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ font: "700 24px/1.2 var(--font-sans)", color: "#fff" }}>{t("design.submitted.title")}</div>
            <div style={{ font: "500 14px/1.5 var(--font-sans)", color: "rgba(255,255,255,.6)", marginTop: 8 }}>
              {submitted.inspectionId ? t("design.submitted.body", { n: submitted.flagged }) : t("design.submitted.queued")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {submitted.inspectionId ? (
              <Link href={`/report/${submitted.inspectionId}?new=1`} className="btn-primary" style={{ width: "auto", padding: "0 26px", height: 52, borderRadius: 15, fontSize: 15 }} data-testid="view-report">
                {t("design.submitted.viewReport")}
              </Link>
            ) : null}
            <button type="button" className="btn-ghost-light" onClick={startNew}>
              {t("design.submitted.startAnother")}
            </button>
          </div>
        </div>
      ) : null}
    </>,
  );
}
