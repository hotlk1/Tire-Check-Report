"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { Button, Spinner, TopBar } from "@/components/ui";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { DiagramLegend, TireDiagram } from "@/components/tire/TireDiagram";
import { TireSheet } from "@/components/tire/TireSheet";
import { useOnline } from "@/lib/client/hooks";
import { draftHasContent, emptyTire, isDraftExpired, newDraft, tireOf, toReadings, type DraftTire, type InspectionDraft } from "@/lib/inspection/draft";
import { deleteDraft, deletePhoto, getDraft, listDraftsForDriver, listPhotosForDraft, pruneOldDrafts, saveDraft, savePhoto, type StoredPhoto } from "@/lib/offline/db";
import { prepareImage } from "@/lib/offline/image";
import { startOutboxWatcher, syncDraft } from "@/lib/offline/sync";
import { blockingIssues, evaluateInspection, tiresForMode, type BlockingIssue } from "@/lib/tires";
import { EquipmentStep } from "./EquipmentStep";
import { ResumePrompt } from "./ResumePrompt";

export interface DriverContext {
  tenantSlug: string;
  tenantName: string;
  driverId: string;
  driverName: string;
}

type Phase = "loading" | "resume" | "equipment" | "inspect";

/**
 * Orchestrates the driver flow: resume/new → equipment → diagram → submit.
 * Every change is written to IndexedDB (autosave), submission goes through
 * the offline outbox so nothing is lost when connectivity drops.
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
  const [issues, setIssues] = useState<BlockingIssue[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // ---- load / resume -------------------------------------------------------
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
    setPhase("equipment");
  };

  // ---- autosave --------------------------------------------------------------
  const update = useCallback((patch: Partial<InspectionDraft> | ((d: InspectionDraft) => Partial<InspectionDraft>)) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const p = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...p, updatedAt: new Date().toISOString() };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveDraft(next)
          .then(() => setSavedAt(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })))
          .catch((e) => console.error("autosave failed", e));
      }, 250);
      return next;
    });
  }, [locale]);

  const updateTire = useCallback(
    (n: number, patch: Partial<DraftTire>) => {
      update((d) => ({ tires: { ...d.tires, [n]: { ...tireOf(d, n), ...patch } } }));
    },
    [update],
  );

  // ---- geolocation (never blocks) -------------------------------------------
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

  // ---- photos ------------------------------------------------------------------
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
    if (!navigator.onLine) return;
    const photo = photos[photoId] ?? (await listPhotosForDraft(draft!.id)).find((p) => p.id === photoId);
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

  // ---- evaluation --------------------------------------------------------------
  const readings = useMemo(() => (draft ? toReadings(draft) : {}), [draft]);
  const mode = draft?.mode ?? null;
  const evaluation = useMemo(() => (mode ? evaluateInspection(mode, readings) : null), [mode, readings]);
  const order = useMemo(() => (mode ? tiresForMode(mode) : []), [mode]);

  // ---- submit -------------------------------------------------------------------
  const submit = async () => {
    if (!draft || !draft.mode) return;
    const found = blockingIssues({ mode: draft.mode, truckSelected: !!draft.truck, trailerSelected: !!draft.trailer, odometer: draft.odometer, readings });
    if (found.length) {
      setIssues(found);
      return;
    }
    setIssues(null);
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
    if (result.ok) {
      router.push(`/report/${result.inspectionId}?new=1`);
    } else if (!result.retryable) {
      setSubmitError(result.error);
      setIssues((result.issues as BlockingIssue[] | undefined) ?? null);
    }
  };

  // While queued offline, keep watching for the outbox to finish.
  useEffect(() => {
    if (!draft || draft.status !== "queued") return;
    const id = window.setInterval(async () => {
      const latest = await getDraft(draft.id);
      if (latest?.inspectionId && (latest.status === "submitted" || latest.status === "queued")) {
        if (latest.status === "submitted") router.push(`/report/${latest.inspectionId}?new=1`);
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [draft, router]);

  // ---- render -------------------------------------------------------------------
  const signOut = async () => {
    await fetch("/api/driver/session", { method: "DELETE" });
    router.push(`/t/${ctx.tenantSlug}`);
  };

  const header = (
    <TopBar
      title={t("inspection.title")}
      subtitle={`${ctx.driverName} · ${ctx.tenantName}`}
      right={
        <div className="flex items-center gap-2">
          <LanguageSwitcher dark />
          <button type="button" onClick={signOut} className="text-[12px] font-semibold text-white/80 hover:text-white">
            {t("driver.signOut")}
          </button>
        </div>
      }
    />
  );

  if (phase === "loading" || !draft) {
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center py-20 text-text-3">
          <Spinner /> <span className="ml-2">{t("app.loading")}</span>
        </div>
      </>
    );
  }

  if (phase === "resume" && candidate) {
    return (
      <>
        {header}
        <ResumePrompt draft={candidate} onResume={resume} onStartNew={startNew} />
      </>
    );
  }

  if (phase === "equipment") {
    return (
      <>
        {header}
        {!online ? <OfflineBanner /> : null}
        <EquipmentStep draft={draft} onChange={update} onStart={startInspection} />
      </>
    );
  }

  const done = evaluation?.summary.completed ?? 0;
  const total = evaluation?.summary.total ?? 0;
  const idx = selected ? order.indexOf(selected) : -1;

  return (
    <>
      {header}
      {!online ? <OfflineBanner /> : null}
      <main className="mx-auto w-full max-w-5xl px-3 pb-32 pt-3 md:grid md:grid-cols-[1fr_320px] md:gap-6 md:px-6">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="text-[13px] text-text-2">
              <span className="font-semibold text-text">{t("inspection.progress", { done, total })}</span>
              <span className="text-text-3"> · {t("inspection.tapTire")}</span>
            </div>
            <button type="button" className="text-[12px] font-semibold text-accent" onClick={() => setPhase("equipment")}>
              {t("equipment.change")}
            </button>
          </div>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-status-green transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <TireDiagram
            mode={mode!}
            readings={readings}
            evaluation={evaluation!}
            selected={selected}
            onSelect={setSelected}
            labels={{ truck: draft.truck?.unitNumber, trailer: draft.trailer?.unitNumber }}
            size="md"
          />
          <div className="mt-3 px-1">
            <DiagramLegend />
          </div>
        </div>

        <aside className="mt-4 md:mt-0">
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-3">{t("inspection.notes")}</div>
            <textarea
              className="mt-1 w-full min-h-[72px] rounded-[var(--radius)] border border-border-strong px-3 py-2 text-[15px]"
              placeholder={t("inspection.notesPlaceholder")}
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-3">
              <span>
                {draft.locationState === "capturing" ? t("inspection.locationCapturing") : draft.locationState === "captured" ? "📍 " + t("inspection.locationCaptured") : draft.locationState === "denied" ? t("inspection.locationDenied") : ""}
              </span>
              {savedAt ? <span>· {t("inspection.savedAt", { time: savedAt })}</span> : null}
            </div>
          </div>

          {issues && issues.length ? (
            <div className="mt-3 rounded-[var(--radius-lg)] border border-status-yellow/40 bg-status-yellow-soft p-3" data-testid="issues">
              <div className="text-[13px] font-bold text-[#92400e]">{t("inspection.issues.title")}</div>
              <ul className="mt-1 space-y-1">
                {issues.map((i, k) => (
                  <li key={k}>
                    <button
                      type="button"
                      className="text-left text-[13px] text-[#92400e] underline-offset-2 hover:underline"
                      onClick={() => {
                        if ("tire" in i) setSelected(i.tire);
                        else setPhase("equipment");
                      }}
                    >
                      {t(`inspection.issues.${i.kind}`, "tire" in i ? { tire: i.tire } : undefined)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {submitError ? <div className="mt-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{t("app.error")} ({submitError})</div> : null}
          {draft.status === "queued" ? <div className="mt-3 rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px] text-accent">{t("inspection.queued")}</div> : null}
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: "calc(12px + var(--safe-bottom))" }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="hidden text-[12px] text-text-3 md:block">{t("inspection.progress", { done, total })}</div>
          <Button className="flex-1 md:max-w-xs md:ml-auto" size="lg" onClick={submit} disabled={submitting || draft.status === "queued"} data-testid="submit">
            {submitting ? <Spinner /> : null}
            {submitting ? t("inspection.submitting") : draft.status === "queued" ? t("inspection.queued") : t("inspection.submit")}
          </Button>
        </div>
      </div>

      {selected !== null && evaluation ? (
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
          onPrev={idx > 0 ? () => setSelected(order[idx - 1]) : undefined}
          onNext={idx >= 0 && idx < order.length - 1 ? () => setSelected(order[idx + 1]) : undefined}
        />
      ) : null}
    </>
  );
}

function OfflineBanner() {
  const { t } = useI18n();
  return <div className="bg-status-yellow-soft px-4 py-1.5 text-center text-[12px] font-semibold text-[#92400e]">{t("app.offline")}</div>;
}
