"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { AppHeader } from "@/components/driver/AppHeader";
import { ApiError, apiJson } from "@/lib/client/api";
import { normalizeUsPhone } from "@/lib/driver/phone";

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

function formatLive(digits: string) {
  if (digits.length > 6) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length > 3) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length) return `(${digits}`;
  return "";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * "Who's inspecting?" (design §1a step 1). The number is matched against the
 * tenant's active drivers as soon as 10 digits are entered; Continue is
 * enabled only after a match. Server still enforces Turnstile + rate limits.
 */
export function DriverEntry({ tenantSlug, tenantName, turnstileSiteKey }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matched, setMatched] = useState<{ name: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const lastTried = useRef<string>("");

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

  const normalized = normalizeUsPhone(digits);
  const canVerify = !!normalized && (!turnstileSiteKey || !!token);

  useEffect(() => {
    if (!canVerify || matched || busy) return;
    const key = `${normalized}:${token ?? ""}`;
    if (lastTried.current === key) return;
    lastTried.current = key;
    let cancelled = false;
    setBusy(true);
    setError(null);
    apiJson<{ ok: true; driver: { name: string } }>("/api/driver/verify", { method: "POST", body: JSON.stringify({ tenant: tenantSlug, phone: normalized, turnstileToken: token }) })
      .then((r) => {
        if (!cancelled) setMatched({ name: r.driver.name });
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : "error";
        setError(code === "rate_limited" ? t("driver.tooManyAttempts") : code === "captcha" ? t("driver.captchaFailed") : code === "denied" ? t("driver.denied") : t("app.error"));
        if (turnstileSiteKey && window.turnstile) {
          window.turnstile.reset(widgetId.current ?? undefined);
          setToken(null);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canVerify, normalized, token]);

  const onInput = (raw: string) => {
    const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
    setDigits(d);
    setMatched(null);
    setError(null);
  };

  const proceed = () => {
    router.push(`/t/${tenantSlug}/inspect`);
    router.refresh();
  };

  return (
    <div className="flex h-dvh flex-col" style={{ background: "var(--bg)", overflow: "hidden" }}>
      {turnstileSiteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={() => setScriptReady(true)} /> : null}
      <AppHeader tenantName={tenantName} step={t("design.step.driver")} right={<LanguageSwitcher dark />} />
      <div className="scr mx-auto w-full max-w-md flex-1 overflow-auto" style={{ padding: "44px 24px 24px", minHeight: 0 }}>
        <div className="h1">{t("design.whoTitle")}</div>
        <div className="sub" style={{ marginTop: 8 }}>{t("design.whoSub")}</div>
        <div className="field field-lg" style={{ marginTop: 30 }}>
          <span style={{ font: "600 17px/1 var(--font-mono)", color: "var(--muted)" }}>+1</span>
          <span style={{ width: 1, height: 24, background: "var(--hair)" }} />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="(555) 000-0000"
            value={formatLive(digits)}
            onChange={(e) => onInput(e.target.value)}
            autoFocus
            data-testid="phone"
            aria-label={t("driver.phoneLabel")}
          />
        </div>
        {turnstileSiteKey ? <div ref={widgetRef} style={{ marginTop: 14 }} /> : null}
        {matched ? (
          <div style={{ marginTop: 16, background: "#fff", border: "1.5px solid var(--st-ok-line)", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 14 }} data-testid="matched">
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--st-ok-tint)", color: "var(--st-ok)", display: "grid", placeItems: "center", font: "700 15px/1 var(--font-sans)" }}>{initials(matched.name)}</div>
            <div style={{ flex: 1 }}>
              <div className="h3">{matched.name}</div>
              <div style={{ font: "500 12px/1.3 var(--font-sans)", color: "var(--text-3)", marginTop: 3 }}>{t("design.driverNo")} · {tenantName}</div>
            </div>
            <span style={{ font: "700 11px/1 var(--font-sans)", color: "var(--st-ok)", letterSpacing: ".06em", textTransform: "uppercase" }}>{t("design.matched")}</span>
          </div>
        ) : error ? (
          <div className="notice" data-status="red" style={{ marginTop: 16 }} role="alert">
            <span className="bang">!</span>
            <span style={{ font: "600 12.5px/1.4 var(--font-sans)" }}>{error}</span>
          </div>
        ) : (
          <div style={{ marginTop: 16, font: "500 12.5px/1.4 var(--font-sans)", color: "var(--muted)", padding: "0 2px" }}>
            {busy ? t("driver.verifying") : digits.length ? t("design.digitsHint", { n: digits.length }) : t("design.noAccount")}
          </div>
        )}
      </div>
      <div style={{ flex: "none", padding: "16px 24px calc(28px + var(--safe-bottom))", background: "var(--bg)" }}>
        <div className="mx-auto max-w-md">
          <button type="button" className="btn-primary" style={{ height: 60 }} disabled={!matched} onClick={proceed} data-testid="continue">
            {t("driver.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
