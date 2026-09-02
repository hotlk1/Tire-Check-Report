"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n";
import { TireDiagram } from "@/components/tire/TireDiagram";
import { buildIssues, verdictOf } from "@/lib/inspection/issues";
import type { HistoryPoint, ReportData, ReportTire } from "@/lib/repos/inspections";
import { AXLES, evaluateInspection, getPosition, tiresForMode, type TireReading } from "@/lib/tires";

interface Props {
  report: ReportData;
  history: HistoryPoint[];
  isNew?: boolean;
  backHref: string;
  /** Rendered inside the admin app: no top bar. */
  embedded?: boolean;
}

function readingsOf(report: ReportData): Record<number, TireReading> {
  const out: Record<number, TireReading> = {};
  for (const t of report.tires) {
    out[t.tire_number] = { number: t.tire_number, psi: t.psi, tread32: t.tread_32nds, damage: t.damage, photoCount: t.photos.length, absent: t.absent };
  }
  return out;
}

/**
 * Hosted one-page report in the same visual language as the review screen
 * (design §1a summary): header card with verdict, diagram, needs-attention
 * list, readings table, notes. Tapping a tire opens details, photos, history.
 */
export function ReportView({ report, history, isNew, backHref, embedded }: Props) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const readings = useMemo(() => readingsOf(report), [report]);
  const evaluation = useMemo(() => evaluateInspection(report.mode, readings, report.threshold.config), [report, readings]);
  const issues = useMemo(
    () => buildIssues({ mode: report.mode, readings, truckSelected: !!report.truck, trailerSelected: !!report.trailer, odometer: report.odometer, config: report.threshold.config }).filter((i) => !i.blocking),
    [report, readings],
  );
  const byNumber = useMemo(() => new Map(report.tires.map((x) => [x.tire_number, x])), [report.tires]);
  const verdict = verdictOf(issues);
  const verdictInk = verdict === "action" ? "var(--st-crit)" : verdict === "watch" ? "var(--st-warn)" : "var(--st-ok)";
  const submitted = new Date(report.submitted_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const pendingPhotos = Math.max(0, report.photos_expected - report.photos_uploaded);
  const sel = selected !== null ? byNumber.get(selected) : undefined;
  const axleLabel = (key: string) => {
    if (key.endsWith("-spare")) return t("design.sheet.spare");
    const axle = AXLES.find((a) => a.key === key);
    return axle ? t(axle.labelKey as MessageKey) : key;
  };
  const labels = {
    truck: report.truck ? `${t("equipment.truck")} ${report.truck.unit_number}${report.truck.make ? ` · ${report.truck.make} ${report.truck.model ?? ""}` : ""}` : undefined,
    trailer: report.trailer ? `${t("equipment.trailer")} ${report.trailer.unit_number}${report.trailer.make ? ` · ${report.trailer.make} ${report.trailer.model ?? ""}` : ""}` : undefined,
  };

  return (
    <div className={embedded ? "" : "min-h-dvh"} style={{ background: embedded ? undefined : "var(--bg)" }}>
      {!embedded ? (
        <header className="app-header no-print" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="mx-auto flex max-w-5xl items-center gap-3" style={{ padding: "12px 20px 14px" }}>
            <Link href={backHref} style={{ font: "600 13px/1 var(--font-sans)", color: "rgba(255,255,255,.8)" }}>‹ {t("app.back")}</Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="wordmark">{t("report.title").toUpperCase()}</div>
              <div style={{ font: "500 10px/1.2 var(--font-sans)", color: "rgba(255,255,255,.5)", letterSpacing: ".08em", textTransform: "uppercase" }}>{report.tenant.name} · {submitted}</div>
            </div>
            <button type="button" className="a-btn" style={{ height: 34, background: "rgba(255,255,255,.1)", borderColor: "rgba(255,255,255,.2)", color: "#fff" }} onClick={() => window.print()}>
              {t("report.print")}
            </button>
          </div>
        </header>
      ) : null}

      <main className={embedded ? "w-full p-3" : "mx-auto w-full max-w-5xl px-3 py-4 md:px-6"}>
        {isNew ? (
          <div className="no-print notice" data-status="green" style={{ marginBottom: 12, justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ font: "600 13px/1.4 var(--font-sans)" }}>✓ {t("report.thanks")}</span>
            <Link href={backHref} className="a-link">{t("report.newInspection")}</Link>
          </div>
        ) : null}
        {pendingPhotos > 0 ? <div className="no-print notice" style={{ marginBottom: 12, background: "var(--indigo-soft)", color: "var(--indigo)", font: "600 12.5px/1.4 var(--font-sans)" }}>{t("report.pendingPhotos", { count: pendingPhotos })}</div> : null}

        <div className="print-page md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
          <div>
            <div className="card" style={{ padding: "14px 16px", marginBottom: 12, borderRadius: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="h3">{[report.truck && `${t("equipment.truck")} ${report.truck.unit_number}`, report.trailer && `${t("equipment.trailer")} ${report.trailer.unit_number}`].filter(Boolean).join(" · ")}</div>
                  <div style={{ font: "500 11.5px/1.3 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>
                    {report.driver.name}
                    {report.odometer !== null ? ` · Odo ${Math.round(report.odometer).toLocaleString(locale)} mi` : ""}
                    {report.hubometer !== null ? ` · Hub ${Math.round(report.hubometer).toLocaleString(locale)} mi` : ""} · {submitted}
                  </div>
                  <div style={{ font: "500 11.5px/1.3 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>
                    {t("report.location")}:{" "}
                    {report.location ? (
                      <a className="a-link" href={`https://maps.google.com/?q=${report.location.lat},${report.location.lng}`} target="_blank" rel="noreferrer">
                        {report.location.lat.toFixed(4)}, {report.location.lng.toFixed(4)}
                      </a>
                    ) : (
                      t("report.noLocation")
                    )}
                    {" · "}{t("report.thresholds")}: {report.threshold.tenant_specific ? `${report.tenant.name} v${report.threshold.version}` : `System v${report.threshold.version}`}
                  </div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div style={{ font: "700 15px/1 var(--font-mono)", color: verdictInk }}>{t(`design.verdict.${verdict}`)}</div>
                  <div className="label-xs" style={{ fontSize: 9.5, marginTop: 2 }}>{t("design.result")}</div>
                </div>
              </div>
            </div>
            <TireDiagram mode={report.mode} readings={readings} evaluation={evaluation} selected={selected} onSelect={setSelected} labels={labels} />
            <p className="no-print" style={{ font: "500 12px/1.4 var(--font-sans)", color: "var(--muted)", marginTop: 4, padding: "0 4px" }}>{t("report.tapHint")}</p>
          </div>

          <div>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ font: "700 13px/1 var(--font-sans)", color: "var(--ink)", letterSpacing: ".06em", textTransform: "uppercase" }}>{t("design.needsAttention")}</span>
                <span className="chip-mono" style={{ color: "var(--st-crit)", background: "var(--st-crit-tint)", fontSize: 11 }}>{issues.length}</span>
              </div>
              {issues.map((it, k) => {
                const pos = getPosition(it.tire);
                return (
                  <button key={k} type="button" onClick={() => setSelected(it.tire)} style={{ display: "flex", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--hair-2)", alignItems: "flex-start", width: "100%", textAlign: "left" }} data-status={it.status}>
                    <span style={{ flex: "none", width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", font: "700 12px/1 var(--font-mono)", background: "var(--s-soft)", color: "var(--s)" }}>{it.tire}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "block" }}>
                      <span style={{ display: "block", font: "700 14px/1.2 var(--font-sans)", color: "var(--ink)" }}>{t("tire.title", { number: it.tire })} · {axleLabel(pos.axleKey)} {pos.positionClass === "spare" ? "" : pos.abbreviation}</span>
                      <span style={{ display: "block", font: "500 12px/1.4 var(--font-sans)", color: "var(--text-3)", marginTop: 3 }}>{t(`design.issue.${it.textKey}`, it.params)}</span>
                    </span>
                    <span className="chip" style={{ flex: "none" }}>{t(`design.tags.${it.tag}`)}</span>
                  </button>
                );
              })}
              {issues.length === 0 ? <div style={{ padding: 16, borderTop: "1px solid var(--hair-2)", font: "500 13px/1.4 var(--font-sans)", color: "var(--st-ok)" }}>{t("design.allWithin")}</div> : null}
            </div>

            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-head"><span className="panel-title">{t("report.allTires")}</span></div>
              <div className="grid-head" style={{ display: "grid", gridTemplateColumns: "44px 1fr 60px 60px 90px" }}>
                <span>{t("report.columns.tire")}</span><span>{t("report.columns.position")}</span><span>{t("report.columns.psi")}</span><span>{t("report.columns.tread")}</span><span>{t("report.columns.status")}</span>
              </div>
              {tiresForMode(report.mode).map((n) => {
                const x = byNumber.get(n);
                const pos = getPosition(n);
                if (!x && pos.positionClass === "spare") return null;
                return (
                  <button key={n} type="button" className="grid-row" style={{ display: "grid", gridTemplateColumns: "44px 1fr 60px 60px 90px", width: "100%", textAlign: "left" }} onClick={() => setSelected(n)}>
                    <span className="cell-mono">{n}</span>
                    <span className="cell">{pos.abbreviation} · {axleLabel(pos.axleKey)}{x?.damage && x.damage !== "none" ? ` · ${x.damage_type ? t(`design.damageTypes.${x.damage_type as "bulge"}`) : t(`damage.${x.damage}`)}` : ""}</span>
                    <span className="cell-num" data-status={x?.psi_status ?? "none"} style={{ color: x?.psi_status && x.psi_status !== "none" ? "var(--s)" : undefined }}>{x?.psi ?? "—"}</span>
                    <span className="cell-num" data-status={x?.tread_status ?? "none"} style={{ color: x?.tread_status && x.tread_status !== "none" ? "var(--s)" : undefined }}>{x?.absent ? "—" : x?.tread_32nds != null ? `${x.tread_32nds}/32` : "—"}</span>
                    <span className="chip" data-status={x?.overall_status ?? "none"} style={{ justifySelf: "start" }}>{x?.absent ? t("tire.noSpare") : t(`tire.status.${x?.overall_status ?? "none"}`)}</span>
                  </button>
                );
              })}
            </div>

            {report.notes ? (
              <div className="card" style={{ marginTop: 12, padding: "14px 16px" }}>
                <div className="label" style={{ color: "var(--ink)" }}>{t("report.notes")}</div>
                <p style={{ marginTop: 8, whiteSpace: "pre-wrap", font: "500 13.5px/1.5 var(--font-sans)", color: "var(--text-2)" }}>{report.notes}</p>
              </div>
            ) : null}
            <div style={{ marginTop: 10, font: "500 11px/1.4 var(--font-sans)", color: "var(--muted-2)" }} className="mono">{report.id}</div>
          </div>
        </div>
      </main>

      {selected !== null ? <TireDetail tire={sel ?? null} number={selected} history={history.filter((h) => h.tire_number === selected)} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function TireDetail({ tire, number, history, onClose }: { tire: ReportTire | null; number: number; history: HistoryPoint[]; onClose: () => void }) {
  const { t, locale } = useI18n();
  const pos = getPosition(number);
  return (
    <>
      <div className="sheet-backdrop no-print" onClick={onClose} aria-hidden />
      <div className="sheet no-print" role="dialog" aria-modal="true" aria-label={t("tire.title", { number })}>
        <header style={{ flex: "none", padding: "14px 18px 12px", borderBottom: "1px solid var(--hair-2)", display: "flex", alignItems: "center", gap: 12 }}>
          <span data-status={tire?.overall_status ?? "none"} style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", font: "700 15px/1 var(--font-mono)", background: "var(--s)", color: "#fff" }}>{number}</span>
          <div style={{ flex: 1 }}>
            <div className="h3">{t(pos.labelKey as MessageKey)}</div>
            <div style={{ font: "500 11.5px/1.2 var(--font-sans)", color: "var(--muted)", marginTop: 3 }}>{t("report.tireDetails")}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("app.close")} style={{ width: 38, height: 38, borderRadius: 11, border: "1.5px solid var(--hair)", background: "#fff", color: "var(--text-3)", font: "600 16px/1 var(--font-sans)" }}>✕</button>
        </header>
        <div className="scr" style={{ flex: 1, overflow: "auto", padding: "14px 18px 24px" }}>
          {tire?.absent ? (
            <p style={{ font: "600 14px/1.4 var(--font-sans)", color: "var(--text-2)" }}>{t("tire.noSpare")}</p>
          ) : tire ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <Kpi label="PSI" value={tire.psi ?? "—"} status={tire.psi_status} />
                <Kpi label={t("design.sheet.treadLabel")} value={tire.tread_32nds !== null ? `${tire.tread_32nds}` : "—"} status={tire.tread_status} />
                <Kpi label={t("tire.damage")} value={tire.damage === "none" ? t("damage.none") : tire.damage_type ? t(`design.damageTypes.${tire.damage_type as "bulge"}`) : t(`damage.${tire.damage}`)} status={tire.damage === "none" ? "none" : tire.damage === "repairable" ? "yellow" : "red"} small />
              </div>
              {tire.variant_label || tire.tire_make || tire.tire_model || tire.tire_size ? (
                <p style={{ marginTop: 10, font: "500 13px/1.4 var(--font-sans)", color: "var(--text-2)" }}>
                  {tire.variant_label ?? [tire.tire_make, tire.tire_model, tire.tire_size].filter(Boolean).join(" · ")}
                  {tire.variant_label ? <span style={{ marginLeft: 6, font: "700 10px/1 var(--font-sans)", letterSpacing: ".08em", color: "var(--accent)" }}>{t("tire.catalog.selected").toUpperCase()}</span> : null}
                </p>
              ) : null}
              {tire.notes ? <p style={{ marginTop: 6, whiteSpace: "pre-wrap", font: "500 13px/1.4 var(--font-sans)" }}>{tire.notes}</p> : null}
              <div className="label" style={{ marginTop: 16 }}>{t("report.photos")}</div>
              {tire.photos.length === 0 ? (
                <p style={{ marginTop: 6, font: "500 13px/1.4 var(--font-sans)", color: "var(--muted)" }}>{t("report.noPhotos")}</p>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {tire.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer" style={{ display: "block", overflow: "hidden", borderRadius: 12, border: "1px solid var(--hair)", background: "var(--hair-2)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" style={{ aspectRatio: "1", width: "100%", objectFit: "cover" }} loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p style={{ font: "500 13px/1.4 var(--font-sans)", color: "var(--muted)" }}>{t("design.legend.notDone")}</p>
          )}
          <div className="label" style={{ marginTop: 16 }}>{t("report.history")}</div>
          {history.length === 0 ? (
            <p style={{ marginTop: 6, font: "500 13px/1.4 var(--font-sans)", color: "var(--muted)" }}>{t("report.historyEmpty")}</p>
          ) : (
            <div className="panel" style={{ marginTop: 8 }}>
              {history.map((h) => (
                <div key={h.inspection_id} className="grid-row" style={{ display: "grid", gridTemplateColumns: "14px 1fr 70px 60px", gap: 8 }} data-status={h.overall_status}>
                  <span className="status-dot" />
                  <span className="cell">{new Date(h.submitted_at).toLocaleDateString(locale, { dateStyle: "medium" })}</span>
                  <span className="cell-num">{h.psi ?? "—"} PSI</span>
                  <span className="cell-num" style={{ textAlign: "right" }}>{h.tread_32nds !== null ? `${h.tread_32nds}/32` : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, status, small }: { label: string; value: React.ReactNode; status: "none" | "green" | "yellow" | "red"; small?: boolean }) {
  return (
    <div className="reading-btn" data-status={status} style={{ background: "var(--s-soft)", borderColor: "var(--s-line)" }}>
      <div className="label-xs">{label}</div>
      <div className="v" style={{ fontSize: small ? 14 : 27, color: status === "none" ? undefined : "var(--s)", fontFamily: small ? "var(--font-sans)" : undefined }}>{value}</div>
    </div>
  );
}
