import Link from "next/link";
import { LineChart } from "@/components/admin/charts";
import { PositionHeatmap } from "@/components/admin/PositionHeatmap";
import { Empty, fmtDate, KpiCard, PageHeader, Panel, StatusPill, Table, Td, Th } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/repos/admin/dashboard";
import { assetBase } from "@/lib/equipment/paths";

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const periodDays = Number(sp.days) === 7 || Number(sp.days) === 90 ? Number(sp.days) : 30;
  const dueDays = Number(session.tenant?.settings?.inspectionDueDays) || 7;
  const data = await loadDashboard(session.scope, { periodDays, dueDays });
  const k = data.kpis;
  const since = data.since;
  const compliancePct = k.driversActive ? Math.round((k.driversCompliant / k.driversActive) * 100) : 0;
  const treadCells = data.positions.map((p) => ({ position_key: p.position_key, value: p.avg_tread, red: p.red, yellow: p.yellow, n: p.n }));
  const psiCells = data.positions.map((p) => ({ position_key: p.position_key, value: p.avg_psi, red: p.red, yellow: p.yellow, n: p.n }));

  return (
    <>
      <PageHeader
        title={t("admin.dashboard.title")}
        subtitle={t("admin.dashboard.subtitle", { tenant: session.tenant?.name ?? "" })}
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/admin?days=${d}`} className={"rounded-md px-2.5 py-1 text-[12px] font-semibold " + (d === periodDays ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-3")}>
                {t(d === 7 ? "admin.common.last7" : d === 30 ? "admin.common.last30" : "admin.common.last90")}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t("admin.dashboard.critical")} value={k.criticalTires} status={k.criticalTires ? "red" : "none"} href={`/admin/tires?status=red&from=${since}`} />
        <KpiCard label={t("admin.dashboard.warnings")} value={k.yellowTires} status={k.yellowTires ? "yellow" : "none"} href={`/admin/tires?status=yellow&from=${since}`} />
        <KpiCard label={t("admin.dashboard.due")} value={k.assetsDue} status={k.assetsDue ? "yellow" : "green"} hint={t("admin.dashboard.dueHint", { days: dueDays })} href="/admin/trucks?due=1" />
        <KpiCard label={t("admin.dashboard.inspections")} value={k.inspections} href={`/admin/reports?from=${since}`} />
        <KpiCard label={t("admin.dashboard.tickets")} value={k.openTickets} href="/admin/tickets" />
        <KpiCard label={t("admin.dashboard.compliance")} value={`${compliancePct}%`} status={compliancePct >= 90 ? "green" : compliancePct >= 60 ? "yellow" : "red"} hint={t("admin.dashboard.complianceHint", { active: k.driversCompliant, total: k.driversActive, days: dueDays })} href="/admin/drivers" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title={t("admin.dashboard.trendPsi")}>
          {data.weekly.length ? <LineChart points={data.weekly.map((w) => ({ x: w.week, y: w.avgPsi }))} unit="PSI" /> : <Empty>{t("admin.dashboard.noData")}</Empty>}
        </Panel>
        <Panel title={t("admin.dashboard.trendTread")}>
          {data.weekly.length ? <LineChart points={data.weekly.map((w) => ({ x: w.week, y: w.avgTread }))} unit="/32" /> : <Empty>{t("admin.dashboard.noData")}</Empty>}
        </Panel>
        <Panel title={t("admin.dashboard.heatTread")} actions={<span className="text-[11px] text-text-3">{t("admin.dashboard.heatHint", { days: periodDays })}</span>}>
          {data.positions.length ? <PositionHeatmap cells={treadCells} unit="/32" /> : <Empty>{t("admin.dashboard.noData")}</Empty>}
        </Panel>
        <Panel title={t("admin.dashboard.heatPsi")} actions={<span className="text-[11px] text-text-3">{t("admin.dashboard.heatHint", { days: periodDays })}</span>}>
          {data.positions.length ? <PositionHeatmap cells={psiCells} unit="PSI" decimals={0} /> : <Empty>{t("admin.dashboard.noData")}</Empty>}
        </Panel>
        <Panel title={t("admin.dashboard.recent")}>
          {data.recent.length === 0 ? (
            <Empty>{t("admin.dashboard.noData")}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.reports.columns.date")}</Th>
                  <Th>{t("admin.reports.columns.driver")}</Th>
                  <Th>{t("admin.reports.columns.truck")}</Th>
                  <Th>{t("admin.reports.columns.trailer")}</Th>
                  <Th right>{t("admin.reports.columns.red")}</Th>
                  <Th right>{t("admin.reports.columns.yellow")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <Td>
                      <Link className="text-accent" href={`/admin/reports/${r.id}`}>
                        {fmtDate(r.submitted_at, locale)}
                      </Link>
                    </Td>
                    <Td>{r.driver_name ?? "—"}</Td>
                    <Td>{r.truck_unit ?? "—"}</Td>
                    <Td>{r.trailer_unit ?? "—"}</Td>
                    <Td right>{r.red}</Td>
                    <Td right>{r.yellow}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title={t("admin.dashboard.spares")} actions={<span className="text-[11px] text-text-3">{t("admin.dashboard.spareHint")}</span>}>
          {data.spares.length === 0 ? (
            <Empty>{t("admin.dashboard.noData")}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.assets.unit")}</Th>
                  <Th>{t("admin.tires.columns.tire")}</Th>
                  <Th right>{t("admin.tires.columns.tread")}</Th>
                  <Th>{t("admin.common.status")}</Th>
                  <Th>{t("admin.tires.columns.date")}</Th>
                </tr>
              </thead>
              <tbody>
                {data.spares.map((s) => (
                  <tr key={`${s.asset_id}-${s.position_key ?? s.tire_number}`}>
                    <Td>
                      <Link className="text-accent" href={`${assetBase(s.type)}/${s.asset_id}`}>
                        {s.unit_number}
                      </Link>
                    </Td>
                    <Td>#{s.tire_number} · {s.position_key?.split("/")[1] ?? ""}</Td>
                    <Td right>{s.absent ? "—" : s.tread_32nds !== null ? `${s.tread_32nds}/32` : "—"}</Td>
                    <Td>{s.absent ? t("tire.noSpare") : <StatusPill status={s.overall_status as "green"}>{t(`tire.status.${s.overall_status as "green"}`)}</StatusPill>}</Td>
                    <Td>{fmtDate(s.submitted_at, locale, false)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
