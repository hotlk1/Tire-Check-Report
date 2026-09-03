"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authProvider } from "@/lib/auth/provider";
import { getAdminSession, TENANT_COOKIE } from "@/lib/auth/session";

export interface FormState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const r = await authProvider().signInWithPassword(email, password);
  if (!r.ok) return { ok: false, error: "failed" };
  const session = await getAdminSession();
  if (!session) {
    await authProvider().signOut();
    return { ok: false, error: "no_access" };
  }
  redirect("/admin");
}

export async function magicLinkAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, error: "failed" };
  const { appOrigin } = await import("@/lib/auth/origin");
  const r = await authProvider().sendMagicLink(email, `${await appOrigin()}/auth/callback?next=/admin`);
  if (!r.ok) return { ok: false, error: "failed" };
  if (authProvider().name === "dev") redirect("/admin");
  return { ok: true, message: "sent" };
}

export async function signOutAction() {
  await authProvider().signOut();
  redirect("/admin/login");
}

export async function switchTenantAction(form: FormData) {
  const slug = String(form.get("tenant") ?? "");
  const store = await cookies();
  store.set({ name: TENANT_COOKIE, value: slug, path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  redirect("/admin");
}
