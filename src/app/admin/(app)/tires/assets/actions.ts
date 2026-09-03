"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { createUnmountedTire, mountTire, replaceTire, setTireState, type TireAssetState } from "@/lib/repos/tire-assets";

const STATES: TireAssetState[] = ["unmounted", "damaged", "removed", "disposed", "lost"];
const label = (s: Awaited<ReturnType<typeof requireAdmin>>) => s.user.name ?? s.user.email;
const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim() || null;

/** Where to return after an action: the asset page or the tire page. */
function back(form: FormData, fallback: string) {
  const r = String(form.get("return") ?? "");
  return r.startsWith("/admin/") ? r : fallback;
}

export async function setTireStateAction(form: FormData) {
  const session = await requireAdmin();
  const tireId = String(form.get("tireId") ?? "");
  const state = String(form.get("state") ?? "") as TireAssetState;
  const to = back(form, `/admin/tires/assets/${tireId}`);
  if (!canConfigure(session)) redirect(`${to}?error=not_allowed`);
  if (!z.string().uuid().safeParse(tireId).success || !STATES.includes(state)) redirect(`${to}?error=invalid`);
  await setTireState(session.scope, { tireId, state, note: str(form, "note") }, label(session));
  revalidatePath(to);
  redirect(`${to}?saved=1`);
}

export async function mountTireAction(form: FormData) {
  const session = await requireAdmin();
  const tireId = String(form.get("tireId") ?? "");
  const assetId = String(form.get("assetId") ?? "");
  const positionKey = String(form.get("positionKey") ?? "");
  const to = back(form, `/admin/tires/assets/${tireId}`);
  if (!canConfigure(session)) redirect(`${to}?error=not_allowed`);
  if (!z.string().uuid().safeParse(tireId).success || !z.string().uuid().safeParse(assetId).success || !/^[a-z0-9-]+(:[A-Z]{1,2})?$/.test(positionKey)) redirect(`${to}?error=invalid`);
  await mountTire(session.scope, { tireId, assetId, positionKey, isSpare: positionKey.startsWith("spare"), note: str(form, "note") }, label(session));
  revalidatePath(to);
  redirect(`${to}?saved=1`);
}

export async function replaceTireAction(form: FormData) {
  const session = await requireAdmin();
  const assetId = String(form.get("assetId") ?? "");
  const positionKey = String(form.get("positionKey") ?? "");
  const oldState = String(form.get("oldState") ?? "removed") as TireAssetState;
  const to = back(form, "/admin/tires/assets");
  if (!canConfigure(session)) redirect(`${to}?error=not_allowed`);
  if (!z.string().uuid().safeParse(assetId).success || !/^[a-z0-9-]+(:[A-Z]{1,2})?$/.test(positionKey) || !STATES.includes(oldState)) redirect(`${to}?error=invalid`);
  const variant = str(form, "tireVariantId");
  await replaceTire(
    session.scope,
    { assetId, positionKey, isSpare: positionKey.startsWith("spare"), oldState, tire: { make: str(form, "make"), model: str(form, "model"), size: str(form, "size"), tireVariantId: variant && z.string().uuid().safeParse(variant).success ? variant : null, serial: str(form, "serial") }, note: str(form, "note") },
    label(session),
  );
  revalidatePath(to);
  redirect(`${to}?saved=1`);
}

export async function registerTireAction(form: FormData) {
  const session = await requireAdmin();
  if (!canConfigure(session)) redirect("/admin/tires/assets?error=not_allowed");
  const created = await createUnmountedTire(session.scope, { make: str(form, "make"), model: str(form, "model"), size: str(form, "size"), tireVariantId: null, serial: str(form, "serial"), notes: str(form, "notes") }, label(session));
  revalidatePath("/admin/tires/assets");
  redirect(`/admin/tires/assets/${created.id}?saved=1`);
}
