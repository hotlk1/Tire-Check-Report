"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { AppHeader } from "@/components/driver/AppHeader";
import { TireDiagram } from "@/components/tire/TireDiagram";
import { TireSheet } from "@/components/tire/TireSheet";
import { useOnline } from "@/lib/client/hooks";
import { draftHasContent, emptyTire, isDraftExpired, newDraft, tireOf, toReadings, type DraftTire, type InspectionDraft } from "@/lib/inspection/draft";
import { buildIssues, verdictOf } from "@/lib/inspection/issues";
import { deleteDraft, deletePhoto, getDraft, listDraftsForDriver, listPhotosForDraft, pruneOldDrafts, saveDraft, savePhoto, type StoredPhoto } from "@/lib/offline/db";
import { prepareImage } from "@/lib/offline/image";
import { startOutboxWatcher, syncDraft } from "@/lib/offline/sync";
import { evaluateInspection, getPosition, tiresForMode } from "@/lib/tires";
import { AXLES } from "@/lib/tires/layout";
import { EquipmentStep } from "./EquipmentStep";
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
 * through the offline outbox.
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
  const saveTimer = useRef<number | null>(null);

  // ---- load / resume --------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await pruneOldDrafts();
        const drafts = await listDraftsForDriver(ctx.tenantSlug, ctx.driverId);
        const open = drafts
          .filter((d) => (d.status === "draft" || d.status === "queued" || d.status === "failed") && !isDraftExpired(d) && draftHasContent(d))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        if (cancelled) return;
        if (open[0]) {
          setCandidate(open[0]);
          setPhase("resume");
        } else {
          const d = newDraft(ctx);
          await saveDraft(d);
          setDraft(d);
          setPhase("equipment");
        }
      } catch (e) {
        console.error("draft load failed", e);
        const d = newDraft(ctx);
        setDraft(d);
        setPhase("equipment");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  useEffect(() => startOutboxWatcher(), []);

  const loadPhotos = useCallback(async (draftId: string) => {
    const list = await listPhotosForDraft(draftId);
    setPhotos(Object.fromEntries(list.map((p) => [p.id, p])));
  }, []);

  const resume = async () => {
    if (!candidate) return;
    setDraft(candidate);
    await loadPhotos(candidate.id);
    setPhase(candidate.mode && (candidate.truck || candidate.trailer) ? "inspect" : "equipment");
  };
  const startNew = async () => {
    if (candidate) await deleteDraft(candidate.id);
    const d = newDraft(ctx);
    await saveDraft(d);
    setDraft(d);
    setPhotos({});
    setSubmitted(null);
    setPhase("equipment");
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
    (n: number, patch: Partial<DraftTire>) => {
      update((d) => ({ tires: { ...d.tires, [n]: { ...tireOf(d, n), ...patch } } }));
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

  const startInspection = () => {
    setPhase("inspect");
    if (draft && draft.locationState === "idle") captureLocation();
  };

  // ---- photos -----------------------------------------------------------------
  const addPhotos = async (n: number, files: FileList) => {
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
      updateTire(n, { photoIds: [...tireOf(draft, n).photoIds, ...ids] });
      void analyze(n, ids[ids.length - 1]);
    }
  };

  const analyze = async (n: number, photoId: string) => {
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
        updateTire(n, { aiSuggestion: { ...data.result, photoId } });
      }
    } catch {
      /* assistive only */
    } finally {
      setAnalyzing(null);
    }
  };

  const removePhoto = async (n: number, photoId: string) => {
    if (!draft) return;
    await deletePhoto(photoId);
    setPhotos((p) => {
      const next = { ...p };
      delete next[photoId];
      return next;
    });
    updateTire(n, { photoIds: tireOf(draft, n).photoIds.filter((id) => id !== photoId) });
  };

  // ---- evaluation ----------------------------------------------------------------
  const readings = useMemo(() => (draft ? toReadings(draft) : {}), [draft]);
  const mode = draft?.mode ?? null;
  const evaluation = useMemo(() => (mode ? evaluateInspection(mode, readings) : null), [mode, readings]);
  const issues = useMemo(
    () => (draft && mode ? buildIssues({ mode, readings, truckSelected: !!draft.truck, trailerSelected: !!draft.trailer, odometer: draft.odometer }) : []),
    [draft, mode, readings],
  );
  const blocking = issues.filter((i) => i.blocking);
  const critical = issues.filter((i) => i.status === "red" && !i.blocking).length;
  const total = evaluation?.summary.total ?? 0;
  const done = evaluation?.summary.completed ?? 0;
  const spareCount = mode ? tiresForMode(mode).filter((n) => getPosition(n).positionClass === "spare").length : 0;
  const spareDone = mode ? tiresForMode(mode).filter((n) => getPosition(n).positionClass === "spare" && evaluation?.tires[n]?.complete).length : 0;
  const progress = { done: done + spareDone, total: total + spareCount };
  const left = progress.total - progress.done;

  // ---- submit ---------------------------------------------------------------------
  const submit = async () => {
    if (!draft || !draft.mode || blocking.length) return;
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
  const header = <AppHeader tenantName={ctx.tenantName} step={stepLabel} progress={phase === "inspect" || phase === "review" ? progress : undefined} right={phase === "equipment" ? <LanguageSwitcher dark /> : undefined} />;

  const shell = (children: React.ReactNode) => (
    <div className="flex h-dvh flex-col" style={{ background: "var(--bg)", overflow: "hidden" }}>
      {header}
      {!online ? <div style={{ background: "var(--st-warn-tint)", color: "#8a6100", font: "600 12px/1 var(--font-sans)", textAlign: "center", padding: "7px 12px" }}>{t("app.offline")}</div> : null}
      {children}
    </div>
  );

  if (phase === "loading" || !draft) {
    return shell(<div className="flex flex-1 items-center justify-center py-20" style={{ color: "var(--muted)" }}>{t("app.loading")}</div>);
  }
  if (phase === "resume" && candidate) return shell(<ResumePrompt draft={candidate} onResume={resume} onStartNew={startNew} />);
  if (phase === "equipment") return shell(<EquipmentStep draft={draft} onChange={update} onStart={startInspection} onBack={signOut} />);

  const labels = {
    truck: draft.truck ? `${t("equipment.truck")} ${draft.truck.unitNumber}${draft.truck.label ? ` · ${draft.truck.label}` : ""}` : undefined,
    trailer: draft.trailer ? `${t("equipment.trailer")} ${draft.trailer.unitNumber}${draft.trailer.label ? ` · ${draft.trailer.label}` : ""}` : undefined,
  };
  const verdict = verdictOf(issues);
  const verdictInk = verdict === "action" ? "var(--st-crit)" : verdict === "watch" ? "var(--st-warn)" : "var(--st-ok)";
  const isReview = phase === "review";

  return shell(
    <>
      <main className="scr mx-auto w-full max-w-5xl flex-1 overflow-auto" style={{ padding: "14px 14px 24px", minHeight: 0 }}>
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px] md:gap-5">
          <div>
            {isReview ? (
              <div className="card" style={{ padding: "14px 16px", marginBottom: 12, borderRadius: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="h3">{[labels.truck, labels.trailer].filter(Boolean).map((l) => l!.split(" · ")[0]).join(" · ")}</div>
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
              <p style={{ font: "500 12px/1.4 var(--font-sans)", color: "var(--muted)", padding: "0 4px 10px" }}>{t("inspection.tapTire")}</p>
            )}
            <TireDiagram mode={mode!} readings={readings} evaluation={evaluation!} selected={selected} onSelect={isReview ? undefined : setSelected} labels={labels} />
          </div>

          <aside>
            {isReview ? (
              <>
                <div className="card" style={{ marginTop: 12, overflow: "hidden" }} data-testid="issues">
                  <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ font: "700 13px/1 var(--font-sans)", color: "var(--ink)", letterSpacing: ".06em", textTransform: "uppercase" }}>{t("design.needsAttention")}</span>
                    <span className="chip-mono" style={{ color: "var(--st-crit)", background: "var(--st-crit-tint)", fontSize: 11 }}>{issues.length}</span>
                  </div>
                  {issues.map((it, k) => {
                    const pos = getPosition(it.tire);
                    const axle = AXLES.find((a) => a.key === pos.axleKey);
                    return (
                      <button key={k} type="button" onClick={() => { setPhase("inspect"); setSelected(it.tire); }} style={{ display: "flex", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--hair-2)", alignItems: "flex-start", width: "100%", textAlign: "left" }} data-status={it.status}>
                        <span style={{ flex: "none", width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", font: "700 12px/1 var(--font-mono)", background: "var(--s-soft)", color: "var(--s)" }}>{it.tire}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "block" }}>
                          <span style={{ display: "block", font: "700 14px/1.2 var(--font-sans)", color: "var(--ink)" }}>
                            {t("tire.title", { number: it.tire })} · {axle ? t(axle.labelKey as MessageKey) : ""} {pos.positionClass === "spare" ? "" : pos.abbreviation}
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
            <button type="button" className="btn-primary" data-tone="ink" style={{ flex: 1 }} disabled={submitting || blocking.length > 0} onClick={submit} data-testid="submit">
              {submitting ? t("inspection.submitting") : critical ? t("design.submitCritical", { n: critical }) : t("inspection.submit")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" style={{ width: 64 }} onClick={() => setPhase("equipment")}>
              {t("app.back")}
            </button>
            <button type="button" className="btn-primary" data-tone={left > 0 ? "ink" : undefined} style={{ flex: 1 }} onClick={() => setPhase("review")} data-testid="review">
              {left > 0 ? t("design.reviewLeft", { n: left }) : t("design.reviewFull")}
            </button>
          </>
        )}
      </div>

      {selected !== null && evaluation && !isReview ? (
        <TireSheet
          key={selected}
          tire={draft.tires[selected] ?? emptyTire(selected)}
          evaluation={evaluation.tires[selected]}
          photos={(draft.tires[selected]?.photoIds ?? []).map((id) => photos[id]).filter(Boolean)}
          analyzing={analyzing === selected}
          onChange={(patch) => updateTire(selected, patch)}
          onAddPhotos={(files) => addPhotos(selected, files)}
          onRemovePhoto={(id) => void removePhoto(selected, id)}
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
