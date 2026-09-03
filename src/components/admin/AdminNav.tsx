"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { signOutAction, switchTenantAction } from "@/app/admin/actions";

const ITEMS: { href: string; key: "dashboard" | "tireCheck" | "reports" | "trucks" | "trailers" | "equipment" | "tires" | "drivers" | "tickets" | "integrations" | "settings"; exact?: boolean; count?: "reports" | "trucks" | "trailers" | "drivers" | "tickets" }[] = [
  { href: "/admin", key: "dashboard", exact: true },
  { href: "/admin/tire-check", key: "tireCheck" },
  { href: "/admin/reports", key: "reports", count: "reports" },
  { href: "/admin/trucks", key: "trucks", count: "trucks" },
  { href: "/admin/trailers", key: "trailers", count: "trailers" },
  { href: "/admin/equipment", key: "equipment" },
  { href: "/admin/tires", key: "tires" },
  { href: "/admin/drivers", key: "drivers", count: "drivers" },
  { href: "/admin/tickets", key: "tickets", count: "tickets" },
  { href: "/admin/integrations", key: "integrations" },
  { href: "/admin/settings", key: "settings" },
];

export interface NavCounts {
  reports: number;
  trucks: number;
  trailers: number;
  drivers: number;
  tickets: number;
}

interface Props {
  user: { email: string; name: string | null; role: string };
  tenant: { slug: string; name: string } | null;
  tenants?: { slug: string; name: string }[];
  authProvider: "supabase" | "dev";
  counts: NavCounts;
}

function initials(name: string) {
  const parts = name.split(/[\s-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Navy sidebar from the design (§1b) with live counts per section. */
export function AdminNav({ user, tenant, tenants, authProvider, counts }: Props) {
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
    <aside className="side md:sticky md:top-0 md:h-dvh md:w-[216px] md:flex-none" style={{ display: "flex", flexDirection: "column", padding: "18px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 16px" }}>
        <div className="mark" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 12 }}>{tenant ? initials(tenant.name) : "TR"}</div>
        <Link href="/admin" className="wordmark" style={{ fontSize: 13, color: "#fff" }}>{t("app.name").toUpperCase()}</Link>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="md:hidden" style={{ marginLeft: "auto", color: "rgba(255,255,255,.7)", font: "600 14px/1 var(--font-sans)" }}>☰</button>
      </div>
      <div className={open ? "block" : "hidden md:block"} style={{ display: undefined }}>
        <form action={switchTenantAction} style={{ padding: "0 6px 14px" }}>
          <label style={{ display: "block", font: "700 9.5px/1 var(--font-sans)", color: "rgba(255,255,255,.4)", letterSpacing: ".1em", textTransform: "uppercase" }}>{t("admin.nav.tenant")}</label>
          <select name="tenant" value={tenant?.slug ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} data-testid="tenant-switcher" style={{ marginTop: 5, width: "100%", height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.06)", color: "#fff", padding: "0 8px", font: "600 13px/1 var(--font-sans)" }}>
            {options.length === 0 && tenant ? <option value={tenant.slug} style={{ color: "#101B3D" }}>{tenant.name}</option> : null}
            {options.map((o) => (
              <option key={o.slug} value={o.slug} style={{ color: "#101B3D" }}>{o.name}</option>
            ))}
          </select>
        </form>
        <nav>
          {ITEMS.map((it) => {
            const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
            const count = it.count ? counts[it.count] : null;
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="side-item" data-active={active}>
                <span className="dot" />
                {t(`admin.nav.${it.key}`)}
                {count !== null && count > 0 ? <span className="count" data-hot={it.key === "tickets"}>{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 18, padding: "12px 8px 0", borderTop: "1px solid rgba(255,255,255,.1)", font: "500 11.5px/1.4 var(--font-sans)", color: "rgba(255,255,255,.45)" }}>
          <div style={{ color: "rgba(255,255,255,.8)", fontWeight: 600 }} className="truncate">{user.name ?? user.email}</div>
          <div className="truncate" style={{ color: "rgba(255,255,255,.3)" }}>{user.email}</div>
          <div style={{ marginTop: 2 }}>{t(`admin.drivers.roles.${user.role as "admin"}`)}{authProvider === "dev" ? " · dev" : ""}</div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <LanguageSwitcher dark />
            <form action={signOutAction}>
              <button type="submit" style={{ font: "600 12px/1 var(--font-sans)", color: "#fff" }}>{t("admin.nav.signOut")}</button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
