import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Admin primitives implementing the design's console (§1b): top bar, panels, grid tables, KPI cards. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="topbar" style={{ margin: "-20px -26px 20px", position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ font: "700 18px/1.1 var(--font-sans)", color: "var(--ink)", margin: 0 }}>{title}</h1>
        {subtitle ? <div style={{ font: "500 11.5px/1.2 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, children, className, actions, flush }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; flush?: boolean }) {
  return (
    <section className={cx("panel", className)}>
      {title ? (
        <header className="panel-head" style={{ justifyContent: "space-between" }}>
          <span className="panel-title">{title}</span>
          {actions}
        </header>
      ) : null}
      <div style={{ padding: flush ? 0 : title ? "0 16px 16px" : 16 }}>{children}</div>
    </section>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("panel overflow-x-auto", className)}>
      <table className="w-full" style={{ font: "500 13px/1.3 var(--font-sans)" }}>{children}</table>
    </div>
  );
}

export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cx("grid-head text-left", right && "text-right", className)} style={{ padding: "9px 12px" }}>{children}</th>;
}

export function Td({ children, className, right, mono }: { children?: ReactNode; className?: string; right?: boolean; mono?: boolean }) {
  return <td className={cx("align-middle", right && "text-right", mono ? "cell-num" : "cell", className)} style={{ padding: "11px 12px", borderTop: "1px solid var(--hair-2)", whiteSpace: "normal" }}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "24px 12px", textAlign: "center", font: "500 13px/1 var(--font-sans)", color: "var(--muted)" }}>{children}</div>;
}

export function KpiCard({ label, value, hint, href, status, unit }: { label: ReactNode; value: ReactNode; hint?: ReactNode; href: string; status?: "none" | "green" | "yellow" | "red" | "indigo" | "cosmic"; unit?: ReactNode }) {
  const custom = status === "indigo" ? { "--s": "var(--indigo)", "--s-line": "#cdd3f3" } : status === "cosmic" ? { "--s": "var(--cosmic)", "--s-line": "#d6cdf3" } : status === "none" || !status ? { "--s": "var(--indigo)", "--s-line": "var(--hair)" } : {};
  return (
    <Link href={href} className="kpi" data-status={status && status !== "indigo" && status !== "cosmic" ? status : undefined} style={custom as React.CSSProperties}>
      <div className="k-label">{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 8 }}>
        <span className="k-value">{value}</span>
        {unit ? <span className="k-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="k-note">{hint}</div> : null}
    </Link>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span style={{ display: "block", font: "600 11px/1 var(--font-sans)", color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</span>
      {children}
      {hint ? <span style={{ display: "block", marginTop: 4, font: "500 11px/1.3 var(--font-sans)", color: "var(--muted-2)" }}>{hint}</span> : null}
    </label>
  );
}

export const inputCls = "a-input";
export const selectCls = "a-input";
export const btnCls = "a-btn";
export const btnPrimary = "a-btn primary";
export const btnSecondary = "a-btn";
export const btnDanger = "a-btn danger";

export function Pagination({ page, total, pageSize, hrefFor, label }: { page: number; total: number; pageSize: number; hrefFor: (p: number) => string; label: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", font: "500 12px/1 var(--font-sans)", color: "var(--text-2)" }}>
      <span>{label}</span>
      <div style={{ display: "flex", gap: 4 }}>
        {page > 1 ? <Link className="a-btn" href={hrefFor(page - 1)}>‹</Link> : null}
        {page < pages ? <Link className="a-btn" href={hrefFor(page + 1)}>›</Link> : null}
      </div>
    </div>
  );
}

export function StatusPill({ status, children }: { status: "none" | "green" | "yellow" | "red"; children?: ReactNode }) {
  return (
    <span className="chip" data-status={status}>
      {children}
    </span>
  );
}

export function fmtDate(iso: string | null | undefined, locale: string, withTime = true) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
