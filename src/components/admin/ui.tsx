import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Plain, information-dense admin primitives. Deliberately unstyled beyond the
 * shared tokens so a single design-alignment pass can restyle everything.
 */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-[13px] text-text-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, children, className, actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-[var(--radius-lg)] border border-border bg-surface", className)}>
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[var(--radius)] border border-border", className)}>
      <table className="w-full text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cx("bg-surface-2 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3", right && "text-right", className)}>{children}</th>;
}

export function Td({ children, className, right, mono }: { children?: ReactNode; className?: string; right?: boolean; mono?: boolean }) {
  return <td className={cx("border-t border-border px-2.5 py-1.5 align-middle", right && "text-right tabular-nums", mono && "font-mono text-[12px]", className)}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[13px] text-text-3">{children}</div>;
}

export function KpiCard({ label, value, hint, href, status }: { label: ReactNode; value: ReactNode; hint?: ReactNode; href: string; status?: "none" | "green" | "yellow" | "red" }) {
  return (
    <Link href={href} className="block rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 transition hover:border-border-strong hover:shadow-[var(--shadow-sm)]" data-status={status ?? "none"}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="mt-1 text-[28px] font-bold leading-none tabular-nums" style={{ color: status && status !== "none" ? "var(--s)" : undefined }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-text-3">{hint}</div> : null}
    </Link>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-text-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-text-3">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "h-10 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-soft";
export const selectCls = inputCls + " pr-8";
export const btnCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] px-3 text-[13px] font-semibold transition disabled:opacity-50";
export const btnPrimary = btnCls + " bg-brand text-white hover:bg-brand-2";
export const btnSecondary = btnCls + " border border-border-strong bg-surface text-text hover:bg-surface-2";
export const btnDanger = btnCls + " border border-status-red/40 bg-status-red-soft text-status-red hover:brightness-95";

export function Pagination({ page, total, pageSize, hrefFor, label }: { page: number; total: number; pageSize: number; hrefFor: (p: number) => string; label: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-[12px] text-text-2">
      <span>{label}</span>
      <div className="flex gap-1">
        {page > 1 ? (
          <Link className={btnSecondary} href={hrefFor(page - 1)}>
            ‹
          </Link>
        ) : null}
        {page < pages ? (
          <Link className={btnSecondary} href={hrefFor(page + 1)}>
            ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function StatusPill({ status, children }: { status: "none" | "green" | "yellow" | "red"; children?: ReactNode }) {
  return (
    <span className="chip" data-status={status}>
      <span className="status-dot" />
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
