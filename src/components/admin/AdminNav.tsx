"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { cx } from "@/lib/cx";
import { signOutAction, switchTenantAction } from "@/app/admin/actions";

const ITEMS: { href: string; key: "dashboard" | "tireCheck" | "reports" | "trucks" | "trailers" | "tires" | "drivers" | "tickets" | "integrations" | "settings"; exact?: boolean }[] = [
  { href: "/admin", key: "dashboard", exact: true },
  { href: "/admin/tire-check", key: "tireCheck" },
  { href: "/admin/reports", key: "reports" },
  { href: "/admin/trucks", key: "trucks" },
  { href: "/admin/trailers", key: "trailers" },
  { href: "/admin/tires", key: "tires" },
  { href: "/admin/drivers", key: "drivers" },
  { href: "/admin/tickets", key: "tickets" },
  { href: "/admin/integrations", key: "integrations" },
  { href: "/admin/settings", key: "settings" },
];

interface Props {
  user: { email: string; name: string | null; role: string };
  tenant: { slug: string; name: string } | null;
  /** Tenants selectable by this user; undefined = super admin (all tenants, loaded lazily). */
  tenants?: { slug: string; name: string }[];
  authProvider: "supabase" | "dev";
}

export function AdminNav({ user, tenant, tenants, authProvider }: Props) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<{ slug: string; name: string }[] | null>(tenants ?? null);
  useEffect(() => {
    if (tenants) return;
    fetch("/api/admin/tenants")
      .then((r) => r.json())
      .then((d: { tenants: { slug: string; name: string }[] }) => setAll(d.tenants))
      .catch(() => setAll([]));
  }, [tenants]);
  const options = all ?? [];

  return (
    <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-dvh md:w-56 md:flex-none md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-base">🛞</span>
          <span className="text-[15px] font-bold">{t("app.name")}</span>
        </Link>
        <button type="button" className="rounded-md px-2 py-1 text-[13px] font-semibold text-text-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          ☰
        </button>
      </div>
      <div className={cx("px-3 pb-3 md:block", open ? "block" : "hidden")}>
        <form action={switchTenantAction} className="mb-3">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-3">{t("admin.nav.tenant")}</label>
          <select
            name="tenant"
            value={tenant?.slug ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="mt-0.5 h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-[13px] font-semibold"
            data-testid="tenant-switcher"
          >
            {options.length === 0 && tenant ? <option value={tenant.slug}>{tenant.name}</option> : null}
            {options.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name}
              </option>
            ))}
          </select>
        </form>
        <nav className="flex flex-col gap-0.5">
          {ITEMS.map((it) => {
            const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className={cx("rounded-md px-2.5 py-1.5 text-[13.5px] font-medium", active ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-3")}
              >
                {t(`admin.nav.${it.key}`)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-4 border-t border-border pt-3 text-[12px] text-text-3">
          <div className="truncate font-semibold text-text-2">{user.name ?? user.email}</div>
          <div className="truncate">{user.email}</div>
          <div className="mt-0.5">
            {t(`admin.drivers.roles.${user.role as "admin"}`)}
            {authProvider === "dev" ? " · dev" : ""}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <LanguageSwitcher />
            <form action={signOutAction}>
              <button type="submit" className="text-[12px] font-semibold text-accent">
                {t("admin.nav.signOut")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
