"use client";

import type { ReactNode } from "react";
import { useT } from "@/i18n/client";

function initials(name: string) {
  const parts = name.split(/[\s-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Navy app chrome (design §1a): tenant mark, wordmark, step label, optional progress. */
export function AppHeader({ tenantName, step, progress, right }: { tenantName: string; step: string; progress?: { done: number; total: number }; right?: ReactNode }) {
  const t = useT();
  return (
    <header className="app-header" style={{ flex: "none", paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex max-w-5xl items-center gap-3" style={{ padding: "12px 20px 14px" }}>
        <div className="mark" aria-hidden>{initials(tenantName)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wordmark">{t("app.name").toUpperCase()}</div>
          <div style={{ font: "500 10px/1.2 var(--font-sans)", color: "rgba(255,255,255,.5)", letterSpacing: ".08em", textTransform: "uppercase" }}>{step}</div>
        </div>
        {progress ? (
          <div style={{ textAlign: "right" }} data-testid="progress">
            <div style={{ font: "600 15px/1 var(--font-mono)", color: "#fff" }}>{progress.done}/{progress.total}</div>
            <div style={{ font: "500 9px/1.2 var(--font-sans)", color: "rgba(255,255,255,.45)", letterSpacing: ".08em", textTransform: "uppercase" }}>{t("design.tiresUnit")}</div>
          </div>
        ) : null}
        {right}
      </div>
    </header>
  );
}
