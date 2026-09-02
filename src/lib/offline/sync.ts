import { toSubmission, type InspectionDraft } from "@/lib/inspection/draft";
import { getPhoto, listDraftsByStatus, saveDraft, savePhoto } from "./db";

/**
 * Submission outbox. A draft marked `queued` is pushed to the server as soon
 * as a connection is available: first the inspection JSON (idempotent on
 * clientDraftId), then every photo (idempotent on clientPhotoId). Partial
 * progress is persisted so a retry only sends what is missing.
 */
export type SyncResult = { ok: true; inspectionId: string; pendingPhotos: number } | { ok: false; error: string; retryable: boolean; issues?: unknown };

let running = false;

export async function syncDraft(draft: InspectionDraft): Promise<SyncResult> {
  if (!draft.mode) return { ok: false, error: "mode_missing", retryable: false };
  let inspectionId = draft.inspectionId;

  draft.status = "submitting";
  draft.attempts += 1;
  draft.updatedAt = new Date().toISOString();
  await saveDraft(draft);

  try {
    if (!inspectionId) {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toSubmission(draft, { locale: navigator.language, userAgent: navigator.userAgent.slice(0, 300), appVersion: "phase1" })),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; inspectionId?: string; error?: string; issues?: unknown };
      if (!res.ok || !data.ok || !data.inspectionId) {
        const retryable = res.status >= 500 || res.status === 429;
        draft.status = retryable ? "queued" : "failed";
        draft.lastError = data.error ?? `http_${res.status}`;
        await saveDraft(draft);
        return { ok: false, error: draft.lastError, retryable, issues: data.issues };
      }
      inspectionId = data.inspectionId;
      draft.inspectionId = inspectionId;
      draft.lastError = null;
      await saveDraft(draft);
    }

    let pending = 0;
    for (const tire of Object.values(draft.tires)) {
      for (const photoId of tire.photoIds) {
        const photo = await getPhoto(photoId);
        if (!photo) continue; // photo lost locally – nothing we can do
        if (photo.uploadedAt) continue;
        const form = new FormData();
        form.set("file", photo.blob, `${photoId}.jpg`);
        form.set("clientPhotoId", photoId);
        form.set("tireNumber", String(tire.number));
        form.set("takenAt", photo.createdAt);
        if (photo.width) form.set("width", String(photo.width));
        if (photo.height) form.set("height", String(photo.height));
        const res = await fetch(`/api/inspections/${inspectionId}/photos`, { method: "POST", body: form });
        if (res.ok) {
          photo.uploadedAt = new Date().toISOString();
          await savePhoto(photo);
        } else if (res.status >= 500 || res.status === 429) {
          pending += 1;
        } else {
          // Permanent rejection (e.g. too large); don't block the inspection on it.
          photo.uploadedAt = new Date().toISOString();
          await savePhoto(photo);
        }
      }
    }

    draft.status = pending > 0 ? "queued" : "submitted";
    draft.submittedAt = draft.submittedAt ?? new Date().toISOString();
    draft.updatedAt = new Date().toISOString();
    await saveDraft(draft);
    return { ok: true, inspectionId, pendingPhotos: pending };
  } catch (e) {
    draft.status = "queued";
    draft.lastError = e instanceof Error ? e.message : "network";
    draft.updatedAt = new Date().toISOString();
    await saveDraft(draft);
    return { ok: false, error: draft.lastError, retryable: true };
  }
}

/** Push everything in the outbox. Safe to call often (online event, interval, app open). */
export async function flushOutbox(): Promise<void> {
  if (running || typeof navigator !== "undefined" && !navigator.onLine) return;
  running = true;
  try {
    const queued = await listDraftsByStatus("queued");
    for (const draft of queued) {
      const r = await syncDraft(draft);
      if (!r.ok && r.retryable) break; // still offline / server down – try later
    }
  } finally {
    running = false;
  }
}

export function startOutboxWatcher(): () => void {
  const onOnline = () => void flushOutbox();
  window.addEventListener("online", onOnline);
  const timer = window.setInterval(() => void flushOutbox(), 45_000);
  void flushOutbox();
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
  };
}
