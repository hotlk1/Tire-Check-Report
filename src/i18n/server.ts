import { cookies, headers } from "next/headers";
import { createTranslator, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "./index";

/** Resolve the request locale on the server: cookie first, then Accept-Language. */
export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const h = await headers();
  return negotiateLocale(h.get("accept-language"));
}

export async function getServerTranslator() {
  const locale = await getRequestLocale();
  return { locale, t: createTranslator(locale) };
}
