"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n/client";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { ApiError, apiJson } from "@/lib/client/api";
import { formatUsPhone, normalizeUsPhone } from "@/lib/driver/phone";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void; theme?: string; size?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

interface Props {
  tenantSlug: string;
  tenantName: string;
  turnstileSiteKey: string | null;
}

/** Phone-number identification against the tenant's active driver list (spec §2). */
export function DriverEntry({ tenantSlug, tenantName, turnstileSiteKey }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey || !scriptReady || !widgetRef.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(widgetRef.current, {
      sitekey: turnstileSiteKey,
      callback: (tok) => setToken(tok),
      "expired-callback": () => setToken(null),
      "error-callback": () => setToken(null),
      size: "flexible",
    });
  }, [turnstileSiteKey, scriptReady]);

  const digits = normalizeUsPhone(phone);
  const canSubmit = !!digits && (!turnstileSiteKey || !!token) && !busy;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!digits) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson<{ ok: true }>("/api/driver/verify", { method: "POST", body: JSON.stringify({ tenant: tenantSlug, phone: digits, turnstileToken: token }) });
      router.push(`/t/${tenantSlug}/inspect`);
      router.refresh();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "error";
      setError(code === "rate_limited" ? t("driver.tooManyAttempts") : code === "captcha" ? t("driver.captchaFailed") : code === "denied" ? t("driver.denied") : t("app.error"));
      if (turnstileSiteKey && window.turnstile) {
        window.turnstile.reset(widgetId.current ?? undefined);
        setToken(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-10 pt-10">
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setScriptReady(true)} /> : null}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-3">{tenantName}</div>
          <h1 className="mt-1 text-[24px] font-bold tracking-tight">{t("driver.title")}</h1>
          <p className="mt-1 text-[14px] text-text-2">{t("driver.subtitle")}</p>
        </div>
        <LanguageSwitcher />
      </div>
      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>{t("driver.phoneLabel")}</Label>
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={t("driver.phonePlaceholder")}
              value={phone}
              onChange={(e) => {
                const raw = e.target.value;
                const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
                setPhone(d.length === 10 ? formatUsPhone(d) : raw);
              }}
              className="text-[20px] font-semibold tracking-wide"
              autoFocus
              data-testid="phone"
            />
          </div>
          {turnstileSiteKey ? <div ref={widgetRef} /> : null}
          {error ? (
            <div className="rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] font-medium text-status-red" role="alert">
              {error}
            </div>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit} data-testid="continue">
            {busy ? <Spinner /> : null}
            {busy ? t("driver.verifying") : t("driver.continue")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
