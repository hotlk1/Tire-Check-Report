"use client";

import { useActionState } from "react";
import { useT } from "@/i18n/client";
import { loginAction, magicLinkAction, type FormState } from "@/app/admin/actions";
import { Field, inputCls, selectCls } from "./ui";

export function LoginForm({ dev, devUsers, initialError }: { dev: boolean; devUsers: { email: string; name: string | null; superAdmin: boolean }[]; initialError?: string }) {
  const t = useT();
  const initialMessage = initialError === "no_access" ? t("admin.login.noAccess") : initialError === "link" ? t("admin.login.linkFailed") : initialError ? t("admin.login.failed") : null;
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  const [linkState, linkAction, linkPending] = useActionState<FormState, FormData>(magicLinkAction, {});
  if (!dev && linkState.ok) {
    return <div className="rounded-[var(--radius)] bg-status-green-soft px-3 py-3 text-[13px] text-status-green">{t("admin.login.linkSent")}</div>;
  }
  return (
    <>
    {initialMessage ? (
      <div className="notice mb-3" data-status="red" style={{ display: "block", font: "600 12.5px/1.4 var(--font-sans)" }} role="alert" data-testid="login-error">
        {initialMessage}
      </div>
    ) : null}
    {!dev ? (
      <form action={linkAction} className="mb-4 space-y-2 border-b border-border pb-4">
        <div className="text-[12px] font-semibold text-text-2">{t("admin.login.linkTitle")}</div>
        <input name="email" type="email" required autoComplete="email" placeholder={t("admin.login.email")} className={inputCls} data-testid="link-email" />
        {linkState.error ? <div className="text-[12px] text-status-red">{t("admin.login.failed")}</div> : null}
        <button type="submit" className="a-btn primary w-full" disabled={linkPending} data-testid="link-submit">
          {t("admin.login.linkSubmit")}
        </button>
        <div className="text-[11px] text-text-3">{t("admin.login.linkHint")}</div>
      </form>
    ) : null}
    <form action={action} className="space-y-3">
      {dev ? (
        <div className="notice" data-status="yellow" style={{ display: "block", font: "500 12px/1.4 var(--font-sans)" }}>
          <div className="font-bold">{t("admin.login.devTitle")}</div>
          {t("admin.login.devHint")}
        </div>
      ) : null}
      <Field label={t("admin.login.email")}>
        {dev ? (
          <select name="email" className={selectCls} defaultValue={devUsers[0]?.email} data-testid="login-email">
            {devUsers.map((u) => (
              <option key={u.email} value={u.email}>
                {u.email} {u.superAdmin ? "(super admin)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input name="email" type="email" required autoComplete="email" className={inputCls} data-testid="login-email" />
        )}
      </Field>
      {!dev ? (
        <Field label={t("admin.login.password")}>
          <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
        </Field>
      ) : null}
      {state.error ? (
        <div className="notice" data-status="red" style={{ display: "block", font: "600 12.5px/1.4 var(--font-sans)" }} role="alert">
          {state.error === "no_access" ? t("admin.login.noAccess") : t("admin.login.failed")}
        </div>
      ) : null}
      <button type="submit" className={dev ? "a-btn primary w-full" : "a-link"} disabled={pending} data-testid="login-submit">
        {dev ? t("admin.login.submit") : t("admin.login.passwordInstead")}
      </button>
    </form>
    </>
  );
}
