import { en, type Messages } from "./messages/en";
import { es } from "./messages/es";
import { ro } from "./messages/ro";
import { ru } from "./messages/ru";

export const LOCALES = ["en", "ro", "ru", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "tc_locale";

export const MESSAGES: Record<Locale, Messages> = { en, ro, ru, es };

type PathsOf<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : PathsOf<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every valid dot-path key, e.g. "driver.title". */
export type MessageKey = PathsOf<Messages>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Pick the best locale from an Accept-Language header or navigator.languages list. */
export function negotiateLocale(candidates: readonly string[] | string | null | undefined): Locale {
  const list = Array.isArray(candidates)
    ? candidates
    : typeof candidates === "string"
      ? candidates.split(",").map((s) => s.split(";")[0].trim())
      : [];
  for (const c of list) {
    const base = c.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function lookup(messages: Messages, key: string): string | undefined {
  let cur: unknown = messages;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export type Params = Record<string, string | number>;

export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export type Translator = (key: MessageKey, params?: Params) => string;

/** Server- or client-side translator for a locale. Falls back to English, then to the key. */
export function createTranslator(locale: Locale): Translator {
  const messages = MESSAGES[locale] ?? en;
  return (key, params) => {
    const raw = lookup(messages, key) ?? lookup(en, key) ?? key;
    return format(raw, params);
  };
}

/** Collect all dot-path keys of a messages object (used by tests + tooling). */
export function collectKeys(obj: object, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(path);
    else if (v && typeof v === "object") out.push(...collectKeys(v, path));
  }
  return out;
}
