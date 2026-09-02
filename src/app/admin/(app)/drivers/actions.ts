"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { createDriver, DriverError, importDrivers, updateDriver } from "@/lib/repos/admin/drivers";
import { inviteUser, removeMembership, setUserRole } from "@/lib/repos/admin/users";

function label(s: Awaited<ReturnType<typeof requireAdmin>>) {
  return s.user.name ?? s.user.email;
}

export async function saveDriverAction(id: string | null, form: FormData) {
  const session = await requireAdmin();
  const input = {
    full_name: String(form.get("full_name") ?? "").trim(),
    phone: String(form.get("phone") ?? ""),
    status: (form.get("status") === "inactive" ? "inactive" : "active") as "active" | "inactive",
    locale: String(form.get("locale") ?? "") || null,
    external_ref: String(form.get("external_ref") ?? "").trim() || null,
  };
  try {
    if (id) await updateDriver(session.scope, id, input, label(session));
    else await createDriver(session.scope, input, label(session));
  } catch (e) {
    if (e instanceof DriverError) redirect(`/admin/drivers?error=${e.code}${id ? `&edit=${id}` : "&add=1"}`);
    throw e;
  }
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers?saved=1");
}

export async function setDriverStatusAction(id: string, form: FormData) {
  const session = await requireAdmin();
  await updateDriver(session.scope, id, { status: form.get("status") === "inactive" ? "inactive" : "active" }, label(session));
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers");
}

export async function importDriversAction(form: FormData) {
  const session = await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File)) redirect("/admin/drivers?error=file");
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const rows = parsed.data.map((r) => ({ name: r.name ?? r.full_name ?? r.driver ?? "", phone: r.phone ?? r.mobile ?? r.cell ?? "", status: r.status }));
  const result = await importDrivers(session.scope, rows, label(session));
  revalidatePath("/admin/drivers");
  const u = new URLSearchParams({ imported: "1", created: String(result.created), updated: String(result.updated), skipped: String(result.skipped) });
  if (result.errors.length) u.set("errors", result.errors.slice(0, 20).map((e) => `${e.row}:${e.reason}`).join(","));
  redirect(`/admin/drivers?${u.toString()}`);
}

export async function inviteUserAction(form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/drivers?error=not_allowed#users");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const role = form.get("role") === "admin" ? "admin" : "editor";
  if (!email.includes("@")) redirect("/admin/drivers?error=email#users");
  try {
    await inviteUser(session.scope, { email, role, actorLabel: label(session) });
  } catch (e) {
    redirect(`/admin/drivers?error=${encodeURIComponent(e instanceof Error ? e.message : "invite_failed")}#users`);
  }
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers?saved=1#users");
}

export async function setUserRoleAction(membershipId: string, form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/drivers?error=not_allowed#users");
  await setUserRole(session.scope, { membershipId, role: form.get("role") === "admin" ? "admin" : "editor", actorLabel: label(session) });
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers?saved=1#users");
}

export async function removeUserAction(membershipId: string) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/drivers?error=not_allowed#users");
  try {
    await removeMembership(session.scope, { membershipId, actorLabel: label(session) });
  } catch (e) {
    redirect(`/admin/drivers?error=${encodeURIComponent(e instanceof Error ? e.message : "failed")}#users`);
  }
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers#users");
}
