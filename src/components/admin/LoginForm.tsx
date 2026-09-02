"use client";

import { useActionState } from "react";
import { useT } from "@/i18n/client";
import { loginAction, type FormState } from "@/app/admin/actions";
import { Field, inputCls, selectCls } from "./ui";

export function LoginForm({ dev, devUsers }: { dev: boolean; devUsers: { email: string; name: string | null; superAdmin: boolean }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
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
      <button type="submit" className="a-btn primary w-full" disabled={pending} data-testid="login-submit">
        {t("admin.login.submit")}
      </button>
    </form>
  );
}
