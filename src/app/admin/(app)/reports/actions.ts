"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { setInspectionDeleted, updateInspectionMeta, updateTireEntry } from "@/lib/repos/admin/reports";

function num(v: FormDataEntryValue | null): number | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function label(s: Awaited<ReturnType<typeof requireAdmin>>) {
  return s.user.name ?? s.user.email;
}

export async function updateTireAction(inspectionId: string, tireNumber: number, form: FormData) {
  const session = await requireAdmin();
  const absent = form.get("absent") === "on";
  await updateTireEntry(
    session.scope,
    inspectionId,
    tireNumber,
    absent
      ? { absent: true, psi: null, tread32: null, damage: "none", notes: String(form.get("notes") ?? "") || null }
      : {
          absent: false,
          psi: num(form.get("psi")),
          tread32: num(form.get("tread32")),
          damage: (String(form.get("damage") ?? "none") as "none" | "repairable" | "non_repairable") || "none",
          notes: String(form.get("notes") ?? "") || null,
        },
    label(session),
  );
  revalidatePath(`/admin/reports/${inspectionId}`);
  redirect(`/admin/reports/${inspectionId}?saved=1#tire-${tireNumber}`);
}

export async function updateMetaAction(inspectionId: string, form: FormData) {
  const session = await requireAdmin();
  await updateInspectionMeta(session.scope, inspectionId, { odometer: num(form.get("odometer")), hubometer: num(form.get("hubometer")), notes: String(form.get("notes") ?? "") || null }, label(session));
  revalidatePath(`/admin/reports/${inspectionId}`);
  redirect(`/admin/reports/${inspectionId}?saved=1`);
}

export async function deleteReportAction(inspectionId: string, form: FormData) {
  const session = await requireAdmin();
  const restore = form.get("restore") === "1";
  await setInspectionDeleted(session.scope, inspectionId, !restore, label(session));
  revalidatePath("/admin/reports");
  redirect(restore ? `/admin/reports/${inspectionId}` : "/admin/reports");
}
