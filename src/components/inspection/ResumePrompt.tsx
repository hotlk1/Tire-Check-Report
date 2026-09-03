"use client";

import { useI18n } from "@/i18n/client";
import type { InspectionDraft } from "@/lib/inspection/draft";

export function ResumePrompt({ draft, onResume, onStartNew }: { draft: InspectionDraft; onResume: () => void; onStartNew: () => void }) {
  const { t, locale } = useI18n();
  const when = new Date(draft.updatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const units = draft.components.map((c) => c.asset?.unitNumber).filter(Boolean).join(" · ");
  return (
    <div className="mx-auto w-full max-w-md flex-1 overflow-auto" style={{ padding: "32px 20px", minHeight: 0 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="h3" style={{ fontSize: 18 }}>{t("driver.resume.title")}</div>
        <p className="sub" style={{ marginTop: 6 }}>{t("driver.resume.body", { when })}</p>
        {units ? <div className="chip-mono" style={{ marginTop: 10, background: "var(--hair-2)", color: "var(--ink)", fontSize: 13 }}>{units}</div> : null}
        <div style={{ marginTop: 20, display: "grid", gap: 8 }}>
          <button type="button" className="btn-primary" onClick={onResume} data-testid="resume">
            {t("driver.resume.continue")}
          </button>
          <button type="button" className="btn-secondary" onClick={onStartNew} data-testid="start-new">
            {t("driver.resume.startNew")}
          </button>
        </div>
      </div>
    </div>
  );
}
