"use client";

import { useI18n } from "@/i18n/client";
import { Button, Card } from "@/components/ui";
import type { InspectionDraft } from "@/lib/inspection/draft";

export function ResumePrompt({ draft, onResume, onStartNew }: { draft: InspectionDraft; onResume: () => void; onStartNew: () => void }) {
  const { t, locale } = useI18n();
  const when = new Date(draft.updatedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const units = [draft.truck?.unitNumber, draft.trailer?.unitNumber].filter(Boolean).join(" + ");
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8">
      <Card className="p-5">
        <div className="text-[18px] font-bold">{t("driver.resume.title")}</div>
        <p className="mt-1 text-[14px] text-text-2">{t("driver.resume.body", { when })}</p>
        {units ? <div className="mt-2 inline-block rounded-md bg-surface-3 px-2 py-1 text-[13px] font-semibold">{units}</div> : null}
        <div className="mt-5 grid gap-2">
          <Button size="lg" onClick={onResume} data-testid="resume">
            {t("driver.resume.continue")}
          </Button>
          <Button size="lg" variant="secondary" onClick={onStartNew} data-testid="start-new">
            {t("driver.resume.startNew")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
