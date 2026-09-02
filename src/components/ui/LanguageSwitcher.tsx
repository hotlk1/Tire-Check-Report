"use client";

import { useI18n } from "@/i18n/client";
import { LOCALES, type Locale } from "@/i18n";

export function LanguageSwitcher({ className, dark }: { className?: string; dark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      aria-label={t("app.language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className={
        (dark ? "bg-white/10 text-white border-white/20" : "bg-surface text-text border-border-strong") +
        " h-8 rounded-md border px-2 text-[12px] font-semibold outline-none " +
        (className ?? "")
      }
    >
      {LOCALES.map((l) => (
        <option key={l} value={l} className="text-text">
          {t(`locale.${l}`)}
        </option>
      ))}
    </select>
  );
}
