import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { InspectionDraft } from "@/lib/inspection/draft";

/**
 * IndexedDB persistence for drafts, photos and the submission outbox.
 * Everything the driver enters is written here immediately (autosave), so a
 * closed browser or lost connection never loses an inspection.
 */
export interface StoredPhoto {
  id: string;
  draftId: string;
  tireNumber: number;
  blob: Blob;
  contentType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  /** Set once the server acknowledged the upload. */
  uploadedAt: string | null;
}

interface TireCheckDB extends DBSchema {
  drafts: { key: string; value: InspectionDraft; indexes: { byDriver: [string, string]; byStatus: string } };
  photos: { key: string; value: StoredPhoto; indexes: { byDraft: string } };
}

let dbPromise: Promise<IDBPDatabase<TireCheckDB>> | null = null;

export function db(): Promise<IDBPDatabase<TireCheckDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = openDB<TireCheckDB>("tire-check", 1, {
      upgrade(database) {
        const drafts = database.createObjectStore("drafts", { keyPath: "id" });
        drafts.createIndex("byDriver", ["tenantSlug", "driverId"]);
        drafts.createIndex("byStatus", "status");
        const photos = database.createObjectStore("photos", { keyPath: "id" });
        photos.createIndex("byDraft", "draftId");
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(draft: InspectionDraft): Promise<void> {
  const d = await db();
  await d.put("drafts", draft);
}

export async function getDraft(id: string): Promise<InspectionDraft | undefined> {
  const d = await db();
  return d.get("drafts", id);
}

export async function listDraftsForDriver(tenantSlug: string, driverId: string): Promise<InspectionDraft[]> {
  const d = await db();
  return d.getAllFromIndex("drafts", "byDriver", [tenantSlug, driverId]);
}

export async function listDraftsByStatus(status: InspectionDraft["status"]): Promise<InspectionDraft[]> {
  const d = await db();
  return d.getAllFromIndex("drafts", "byStatus", status);
}

export async function deleteDraft(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["drafts", "photos"], "readwrite");
  await tx.objectStore("drafts").delete(id);
  const photos = await tx.objectStore("photos").index("byDraft").getAllKeys(id);
  for (const key of photos) await tx.objectStore("photos").delete(key);
  await tx.done;
}

export async function savePhoto(photo: StoredPhoto): Promise<void> {
  const d = await db();
  await d.put("photos", photo);
}

export async function getPhoto(id: string): Promise<StoredPhoto | undefined> {
  const d = await db();
  return d.get("photos", id);
}

export async function deletePhoto(id: string): Promise<void> {
  const d = await db();
  await d.delete("photos", id);
}

export async function listPhotosForDraft(draftId: string): Promise<StoredPhoto[]> {
  const d = await db();
  return d.getAllFromIndex("photos", "byDraft", draftId);
}

/** Remove drafts (and their photos) that were submitted long ago or expired without content. */
export async function pruneOldDrafts(maxAgeMs = 3 * 24 * 60 * 60 * 1000): Promise<void> {
  const d = await db();
  const all = await d.getAll("drafts");
  const cutoff = Date.now() - maxAgeMs;
  for (const draft of all) {
    const age = new Date(draft.updatedAt).getTime();
    if (age < cutoff && (draft.status === "submitted" || draft.status === "draft")) {
      await deleteDraft(draft.id);
    }
  }
}
