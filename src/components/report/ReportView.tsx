"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { Button, StatusBadge, TopBar } from "@/components/ui";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { TireDiagram } from "@/components/tire/TireDiagram";
import type { HistoryPoint, ReportData, ReportTire } from "@/lib/repos/inspections";
import { AXLES, evaluateInspection, getPosition, tiresForMode, type TireReading } from "@/lib/tires";

interface Props {
  report: ReportData;
  history: HistoryPoint[];
  isNew?: boolean;
  backHref: string;
}

function readingsOf(report: ReportData): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const t of report.tires) {
    out[t.tire_number] = { number: t.tire_number, psi: t.psi, tread32: t.tread_32nds, damage: t.damage, photoCount: t.photos.length };
  }
  return out;
}

function fmtMiles(v: number | null, unit: string) {
  return v === null ? "—" : `${Math.round(v).toLocaleString()} ${unit}`;
}

/**
 * One-page, print-friendly report using the same diagram language as the
 * inspection screen. Tapping a tire opens its details, photos and history.
 */
export function ReportView({ report, history, isNew, backHref }: Props) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const readings = useMemo(() => readingsOf(report), [report]);
  const evaluation = useMemo(() => evaluateInspection(report.mode, readings, report.threshold.config), [report, readings]);
  const byNumber = useMemo(() => new Map(report.tires.map((x) => [x.tire_number, x])), [report.tires]);

  const submitted = new Date(report.submitted_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const actionItems = report.tires.filter((x) => x.overall_status === "red" || x.overall_status === "yellow" || x.damage !== "none");
  const pendingPhotos = Math.max(0, report.photos_expected - report.photos_uploaded);
  const tireOrder = tiresForMode(report.mode);
  const sel = selected !== null ? byNumber.get(selected) : undefined;

  const axleLabel = (key: string) => {
    const axle = AXLES.find((a) => a.key === key);
    return axle ? t(axle.labelKey as MessageKey) : key;
  };

  return (
    <>
      <div className="no-print">
        <TopBar
          title={t("report.title")}
          subtitle={`${report.tenant.name} · ${submitted}`}
          left={
            <Link href={backHref} className="text-[13px] font-semibold text-white/80 hover:text-white">
              ‹ {t("app.back")}
            </Link>
          }
          right={
            <div className="flex items-center gap-2">
              <LanguageSwitcher dark />
              <Button size="sm" variant="secondary" type="button" onClick={() => window.print()}>
                {t("report.print")}
              </Button>
            </div>
          }
        />
      </div>

      <main className="mx-auto w-full max-w-5xl px-3 py-4 md:px-6">
        {isNew ? (
          <div className="no-print mb-3 flex items-center justify-between rounded-[var(--radius)] bg-status-green-soft px-4 py-2.5 text-[14px] font-semibold text-status-green">
            <span>✓ {t("report.thanks")}</span>
            <Link href={backHref} className="text-[13px] underline">
              {t("report.newInspection")}
            </Link>
          </div>
        ) : null}
        {pendingPhotos > 0 ? <div className="no-print mb-3 rounded-[var(--radius)] bg-accent-soft px-4 py-2 text-[13px] text-accent">{t("report.pendingPhotos", { count: pendingPhotos })}</div> : null}

        <div className="print-page rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] md:p-6">
          {/* header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-3">{report.tenant.name}</div>
              <h1 className="text-[22px] font-bold tracking-tight">{t("report.title")}</h1>
              <div className="text-[13px] text-text-2">
                {t("report.submitted")}: {submitted}
              </div>
            </div>
            <div className="flex gap-2">
              <Stat label={t("report.critical")} value={evaluation.summary.red} status="red" />
              <Stat label={t("report.warnings")} value={evaluation.summary.yellow} status="yellow" />
              <Stat label={t("report.good")} value={evaluation.summary.green} status="green" />
            </div>
          </div>

          {/* meta */}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3 md:grid-cols-6">
            <Meta label={t("report.driver")} value={report.driver.name} />
            <Meta label={t("report.truck")} value={report.truck ? `${report.truck.unit_number}${report.truck.make ? ` · ${report.truck.make} ${report.truck.model ?? ""}` : ""}` : "—"} />
            <Meta label={t("report.trailer")} value={report.trailer ? `${report.trailer.unit_number}${report.trailer.make ? ` · ${report.trailer.make} ${report.trailer.model ?? ""}` : ""}` : "—"} />
            <Meta label={t("report.odometer")} value={fmtMiles(report.odometer, t("report.mi"))} />
            <Meta label={t("report.hubometer")} value={fmtMiles(report.hubometer, t("report.mi"))} />
            <Meta
              label={t("report.location")}
              value={
                report.location ? (
                  <a className="text-accent underline-offset-2 hover:underline" href={`https://maps.google.com/?q=${report.location.lat},${report.location.lng}`} target="_blank" rel="noreferrer">
                    {report.location.lat.toFixed(4)}, {report.location.lng.toFixed(4)}
                    {report.location.accuracy ? <span className="text-text-3"> {t("report.locationAccuracy", { meters: Math.round(report.location.accuracy) })}</span> : null}
                  </a>
                ) : (
                  t("report.noLocation")
                )
              }
            />
          </dl>

          {/* body */}
          <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <TireDiagram
                mode={report.mode}
                readings={readings}
                evaluation={evaluation}
                selected={selected}
                onSelect={setSelected}
                labels={{ truck: report.truck?.unit_number, trailer: report.trailer?.unit_number }}
                size="md"
              />
              <p className="no-print mt-2 text-[12px] text-text-3">{t("inspection.tapTire")}</p>
            </div>

            <div className="space-y-4">
              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("report.actionRequired")}</h2>
                {actionItems.length === 0 ? (
                  <p className="mt-1 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("report.noIssues")}</p>
                ) : (
                  <ul className="mt-1 divide-y divide-border rounded-[var(--radius)] border border-border">
                    {actionItems.map((x) => (
                      <li key={x.id}>
                        <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2" onClick={() => setSelected(x.tire_number)}>
                          <span className="status-dot" data-status={x.overall_status} />
                          <span className="w-8 text-[14px] font-bold">#{x.tire_number}</span>
                          <span className="flex-1 text-[13px] text-text-2">
                            {t(getPosition(x.tire_number).labelKey as MessageKey)} · {x.psi !== null ? `${x.psi} PSI` : "—"} · {x.tread_32nds !== null ? `${x.tread_32nds}/32` : "—"}
                            {x.damage !== "none" ? ` · ${t(`damage.${x.damage}`)}` : ""}
                          </span>
                          {x.photos.length ? <span className="text-[11px] text-text-3">📷 {x.photos.length}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("report.allTires")}</h2>
                <div className="mt-1 overflow-x-auto rounded-[var(--radius)] border border-border">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-text-3">
                      <tr>
                        <th className="px-2 py-1.5">{t("report.columns.tire")}</th>
                        <th className="px-2 py-1.5">{t("report.columns.position")}</th>
                        <th className="px-2 py-1.5 text-right">{t("report.columns.psi")}</th>
                        <th className="px-2 py-1.5 text-right">{t("report.columns.tread")}</th>
                        <th className="px-2 py-1.5">{t("report.columns.damage")}</th>
                        <th className="px-2 py-1.5">{t("report.columns.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tireOrder.map((n) => {
                        const x = byNumber.get(n);
                        const pos = getPosition(n);
                        if (!x && pos.positionClass === "spare") return null;
                        return (
                          <tr key={n} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => setSelected(n)}>
                            <td className="px-2 py-1.5 font-bold">{n}</td>
                            <td className="px-2 py-1.5 text-text-2">
                              {pos.abbreviation} · {axleLabel(pos.axleKey)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums" data-status={x?.psi_status ?? "none"} style={{ color: x?.psi_status && x.psi_status !== "none" && x.psi_status !== "green" ? "var(--s)" : undefined }}>
                              {x?.psi ?? "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums" data-status={x?.tread_status ?? "none"} style={{ color: x?.tread_status && x.tread_status !== "none" && x.tread_status !== "green" ? "var(--s)" : undefined }}>
                              {x?.tread_32nds !== null && x?.tread_32nds !== undefined ? `${x.tread_32nds}/32` : "—"}
                            </td>
                            <td className="px-2 py-1.5">{x ? t(`damage.${x.damage}`) : "—"}</td>
                            <td className="px-2 py-1.5">
                              <StatusBadge status={x?.overall_status ?? "none"}>{t(`tire.status.${x?.overall_status ?? "none"}`)}</StatusBadge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* axle comparisons */}
              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("tires.compare.sideToSide")}</h2>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.values(evaluation.axles).map((ax) => (
                    <span key={ax.axleKey} className="chip" data-status={ax.sideToSideStatus}>
                      {axleLabel(ax.axleKey)} {ax.sideToSidePsiDiff === null ? "—" : `Δ${ax.sideToSidePsiDiff}`}
                      {ax.pairs.map((p) => (
                        <span key={p.side} className="ml-1 opacity-80">
                          {p.side === "left" ? "L" : "R"}
                          {p.treadMatch === null ? "" : p.treadMatch ? "=" : "≠"}
                        </span>
                      ))}
                    </span>
                  ))}
                </div>
              </section>

              {report.notes ? (
                <section>
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("report.notes")}</h2>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-text-2">{report.notes}</p>
                </section>
              ) : null}
            </div>
          </div>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-text-3">
            <span>
              {t("report.thresholds")}: {report.threshold.tenant_specific ? `${report.tenant.name} v${report.threshold.version}` : `System v${report.threshold.version}`}
            </span>
            <span className="font-mono">{report.id}</span>
          </footer>
        </div>
      </main>

      {sel ? <TireDetail tire={sel} history={history.filter((h) => h.tire_number === sel.tire_number)} onClose={() => setSelected(null)} /> : selected !== null ? <TireDetail tire={null} number={selected} history={[]} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function Stat({ label, value, status }: { label: string; value: number; status: "red" | "yellow" | "green" }) {
  return (
    <div className="min-w-[72px] rounded-[var(--radius)] border border-border px-3 py-1.5 text-center" data-status={status}>
      <div className="text-[20px] font-bold leading-tight" style={{ color: value > 0 ? "var(--s)" : "var(--text-3)" }}>
        {value}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</dt>
      <dd className="font-semibold text-text">{value}</dd>
    </div>
  );
}

function TireDetail({ tire, number, history, onClose }: { tire: ReportTire | null; number?: number; history: HistoryPoint[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const n = tire?.tire_number ?? number!;
  const pos = getPosition(n);
  return (
    <>
      <div className="sheet-backdrop no-print" onClick={onClose} aria-hidden />
      <div className="sheet no-print" role="dialog" aria-modal="true" aria-label={t("tire.title", { number: n })}>
        <header className="flex items-center gap-3 px-4 pb-2 pt-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white" data-status={tire?.overall_status ?? "none"} style={{ boxShadow: "0 0 0 3px var(--s)" }}>
            {n}
          </div>
          <div className="flex-1">
            <div className="text-[16px] font-bold">{t(pos.labelKey as MessageKey)}</div>
            <div className="text-[12px] text-text-3">{t("report.tireDetails")}</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:bg-surface-3" aria-label={t("app.close")}>
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {tire ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Kpi label={t("tire.psi")} value={tire.psi ?? "—"} status={tire.psi_status} />
                <Kpi label={t("tire.tread")} value={tire.tread_32nds !== null ? `${tire.tread_32nds}/32` : "—"} status={tire.tread_status} />
                <Kpi label={t("tire.damage")} value={t(`damage.${tire.damage}`)} status={tire.damage === "none" ? "green" : tire.damage === "repairable" ? "yellow" : "red"} />
              </div>
              {(tire.tire_make || tire.tire_model || tire.tire_size) && (
                <p className="mt-3 text-[13px] text-text-2">{[tire.tire_make, tire.tire_model, tire.tire_size].filter(Boolean).join(" · ")}</p>
              )}
              {tire.notes ? <p className="mt-2 whitespace-pre-wrap text-[13px]">{tire.notes}</p> : null}
              {tire.ai_suggestion && typeof tire.ai_suggestion.tread32 === "number" ? (
                <p className="mt-2 text-[12px] text-text-3">
                  {t("tire.aiEstimate", { value: tire.ai_suggestion.tread32 as number, confidence: Math.round(((tire.ai_suggestion.confidence as number) ?? 0) * 100) })}
                  {tire.ai_suggestion.accepted === true ? " ✓" : ""}
                </p>
              ) : null}
              <h3 className="mt-4 text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("report.photos")}</h3>
              {tire.photos.length === 0 ? (
                <p className="mt-1 text-[13px] text-text-3">{t("report.noPhotos")}</p>
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {tire.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[var(--radius)] border border-border bg-surface-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-[13px] text-text-3">{t("inspection.legend.none")}</p>
          )}

          <h3 className="mt-4 text-[12px] font-bold uppercase tracking-[0.08em] text-text-3">{t("report.history")}</h3>
          {history.length === 0 ? (
            <p className="mt-1 text-[13px] text-text-3">{t("report.historyEmpty")}</p>
          ) : (
            <ul className="mt-1 divide-y divide-border rounded-[var(--radius)] border border-border text-[13px]">
              {history.map((h) => (
                <li key={h.inspection_id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="status-dot" data-status={h.overall_status} />
                  <span className="flex-1 text-text-2">{new Date(h.submitted_at).toLocaleDateString(locale, { dateStyle: "medium" })}</span>
                  <span className="tabular-nums">{h.psi ?? "—"} PSI</span>
                  <span className="w-12 text-right tabular-nums">{h.tread_32nds !== null ? `${h.tread_32nds}/32` : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, status }: { label: string; value: React.ReactNode; status: "none" | "green" | "yellow" | "red" }) {
  return (
    <div className="rounded-[var(--radius)] border border-border px-3 py-2" data-status={status}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-3">{label}</div>
      <div className="text-[18px] font-bold" style={{ color: status === "none" ? undefined : "var(--s)" }}>
        {value}
      </div>
    </div>
  );
}
