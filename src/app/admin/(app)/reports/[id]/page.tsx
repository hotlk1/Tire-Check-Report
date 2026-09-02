import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { fmtDate, PageHeader, Panel, Table, Td, Th, btnDanger, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { ReportView } from "@/components/report/ReportView";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { withScope } from "@/lib/db/client";
import { inspectionAudit } from "@/lib/repos/admin/reports";
import { loadReport, reportHistory } from "@/lib/repos/inspections";
import { getPosition, tiresForMode } from "@/lib/tires";
import { deleteReportAction, updateMetaAction, updateTireAction } from "../actions";

export default async function AdminReportPage({ params, searchParams }: PageProps<"/admin/reports/[id]">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  // Deleted inspections are still viewable by admins (soft delete) so they can be restored.
  const [statusRow] = await withScope(session.scope, (tx) => tx<{ status: string }[]>`select status from inspections where id = ${id} and tenant_id = ${session.scope.tenantId}`);
  if (!statusRow) notFound();
  const deleted = statusRow.status === "deleted";
  const report = deleted ? null : await loadReport(session.scope, id);
  const history = report ? await reportHistory(session.scope, [report.truck?.id, report.trailer?.id].filter((x): x is string => !!x), report.id) : [];
  const auditRows = await inspectionAudit(session.scope, id);

  return (
    <>
      <PageHeader
        title={t("admin.reports.detail")}
        subtitle={report ? `${fmtDate(report.submitted_at, locale)} · ${report.driver.name}` : t("admin.reports.deleted")}
        actions={
          <>
            <Link className={btnSecondary} href="/admin/reports">
              ‹ {t("admin.nav.reports")}
            </Link>
            {report ? (
              <a className={btnSecondary} href={`/report/${id}`} target="_blank" rel="noreferrer">
                {t("admin.reports.viewReport")} ↗
              </a>
            ) : null}
            <form action={deleteReportAction.bind(null, id)}>
              {deleted ? <input type="hidden" name="restore" value="1" /> : null}
              <button type="submit" className={deleted ? btnPrimary : btnDanger} data-testid="delete-report">
                {deleted ? t("admin.reports.restoreReport") : t("admin.reports.deleteReport")}
              </button>
            </form>
          </>
        }
      />
      {sp.saved ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}

      {report ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface">
            <ReportView report={report} history={history} backHref="/admin/reports" embedded />
          </div>
          <div className="space-y-4">
            <Panel title={t("admin.reports.editMeta")}>
              <form action={updateMetaAction.bind(null, id)} className="grid grid-cols-2 gap-2">
                <label className="text-[12px] text-text-2">
                  {t("admin.reports.odometer")}
                  <input name="odometer" type="number" step="1" defaultValue={report.odometer ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.reports.hubometer")}
                  <input name="hubometer" type="number" step="1" defaultValue={report.hubometer ?? ""} className={inputCls} />
                </label>
                <label className="col-span-2 text-[12px] text-text-2">
                  {t("admin.reports.notes")}
                  <textarea name="notes" defaultValue={report.notes ?? ""} className={inputCls + " h-20 py-2"} />
                </label>
                <div className="col-span-2">
                  <button type="submit" className={btnPrimary}>
                    {t("admin.common.save")}
                  </button>
                </div>
              </form>
            </Panel>

            <Panel title={t("admin.reports.editTire", { number: "" }).replace(/\s+$/, "")}>
              <p className="mb-2 text-[12px] text-text-3">{t("admin.reports.reevaluated", { version: report.threshold.version })}</p>
              <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
                {tiresForMode(report.mode).map((n) => {
                  const e = report.tires.find((x) => x.tire_number === n);
                  const pos = getPosition(n);
                  const spare = pos.positionClass === "spare";
                  return (
                    <form key={n} id={`tire-${n}`} action={updateTireAction.bind(null, id, n)} className="grid grid-cols-[36px_1fr_1fr_1fr_auto] items-end gap-1.5 rounded-[var(--radius)] border border-border px-2 py-1.5" data-status={e?.overall_status ?? "none"}>
                      <div className="flex h-9 items-center justify-center rounded-md bg-surface-3 text-[13px] font-bold" style={{ boxShadow: "inset 0 0 0 2px var(--s)" }}>
                        {n}
                      </div>
                      {spare ? (
                        <label className="flex h-9 items-center gap-1 text-[12px] text-text-2">
                          <input type="checkbox" name="absent" defaultChecked={!!e?.absent} /> {t("tire.noSpare")}
                        </label>
                      ) : (
                        <input name="psi" type="number" step="0.5" placeholder={t("admin.reports.psi")} defaultValue={e?.psi ?? ""} className={inputCls + " h-9"} />
                      )}
                      <input name="tread32" type="number" step="1" min="0" max="40" placeholder={t("admin.reports.tread")} defaultValue={e?.tread_32nds ?? ""} className={inputCls + " h-9"} />
                      <select name="damage" defaultValue={e?.damage ?? "none"} className={selectCls + " h-9"}>
                        <option value="none">{t("damage.none")}</option>
                        <option value="repairable">{t("damage.repairable")}</option>
                        <option value="non_repairable">{t("damage.non_repairable")}</option>
                      </select>
                      <input type="hidden" name="notes" value={e?.notes ?? ""} />
                      <button type="submit" className={btnSecondary + " h-9"} aria-label={t("admin.common.save")}>
                        ✓
                      </button>
                      <div className="col-span-5 text-[11px] text-text-3">
                        {pos.abbreviation} · {e?.absent ? t("tire.noSpare") : e ? t(`tire.status.${e.overall_status}`) : t("tire.status.none")}
                        {e?.photos.length ? ` · 📷 ${e.photos.length}` : ""}
                      </div>
                    </form>
                  );
                })}
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      <Panel title={t("admin.reports.history")} className="mt-4">
        {auditRows.length === 0 ? (
          <p className="text-[13px] text-text-3">{t("admin.reports.noHistory")}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.settings.auditColumns.when")}</Th>
                <Th>{t("admin.settings.auditColumns.who")}</Th>
                <Th>{t("admin.settings.auditColumns.action")}</Th>
                <Th>{t("admin.settings.auditColumns.entity")}</Th>
                <Th>{t("admin.settings.auditColumns.change")}</Th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((a) => (
                <tr key={a.id}>
                  <Td>{fmtDate(a.created_at, locale)}</Td>
                  <Td>{a.actor_label ?? "—"}</Td>
                  <Td>{a.action}</Td>
                  <Td>{a.entity_type}</Td>
                  <Td mono>
                    {a.old_value ? <span className="text-status-red">− {JSON.stringify(a.old_value)}</span> : null}
                    {a.old_value && a.new_value ? <br /> : null}
                    {a.new_value ? <span className="text-status-green">+ {JSON.stringify(a.new_value)}</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
