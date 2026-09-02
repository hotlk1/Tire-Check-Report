"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-[var(--radius)] transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none";
  const sizes: Record<Size, string> = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-13 px-5 text-base" };
  const variants: Record<Variant, string> = {
    primary: "bg-brand text-white hover:bg-brand-2 shadow-sm",
    secondary: "bg-surface text-text border border-border-strong hover:bg-surface-2",
    ghost: "bg-transparent text-text-2 hover:bg-surface-3",
    danger: "bg-status-red text-white hover:brightness-95",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-12 w-full rounded-[var(--radius)] border border-border-strong bg-surface px-3.5 text-[16px] outline-none transition focus:border-accent focus:ring-[3px] focus:ring-accent-soft placeholder:text-text-3",
        className,
      )}
      {...rest}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-sm)]", className)}>{children}</div>;
}

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-1.5 flex items-baseline justify-between", className)}>
      <span className="text-[13px] font-semibold text-text-2">{children}</span>
      {hint ? <span className="text-[12px] text-text-3">{hint}</span> : null}
    </div>
  );
}

export function StatusBadge({ status, children }: { status: "none" | "green" | "yellow" | "red"; children: ReactNode }) {
  return (
    <span className="chip" data-status={status}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      aria-hidden
    />
  );
}

export function TopBar({ title, subtitle, left, right }: { title: ReactNode; subtitle?: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-brand text-white shadow-[var(--shadow)]" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        {left}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight">{title}</div>
          {subtitle ? <div className="truncate text-[12px] leading-tight text-white/70">{subtitle}</div> : null}
        </div>
        {right}
      </div>
    </header>
  );
}
