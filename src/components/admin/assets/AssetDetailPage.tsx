import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LineChart } from "@/components/admin/charts";
import { Empty, PageHeader, Panel, Table, Td, Th, btnDanger, btnPrimary, btnSecondary, fmtDate } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { assetInspections, assetPositionSeries, getAsset } from "@/lib/repos/admin/assets";
import { saveAssetAction, setAssetStatusAction } from "@/app/admin/(app)/assets-actions";
import { getPosition } from "@/lib/tires";
import { AssetForm } from "./AssetForm";

export async function AssetDetailPage({ type, id, searchParams }: { type: "truck" | "trailer"; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  if (!z.string().uuid().safeParse(id).success) notFound();
  const asset = await getAsset(session.scope, id);
  if (!asset || asset.type !== type) notFound();
  const [inspections, series] = await Promise.all([assetInspections(session.scope, id), assetPositionSeries(session.scope, id)]);
  const base = type === "truck" ? "/admin/trucks" : "/admin/trailers";
  const latest = series.map((s) => ({ n: s.tire_number, last: s.points[s.points.length - 1] })).filter((x) => x.last);
  const editing = searchParams.edit === "1";

  return (
    <>
      <PageHeader
        title={asset.unit_number}
        subtitle={[asset.year, asset.make, asset.model, asset.license_plate, asset.vin].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link className={btnSecondary} href={base}>
              ‹ {t(type === "truck" ? "admin.assets.trucks" : "admin.assets.trailers")}
            </Link>
            <Link className={btnSecondary} href={`${base}/${id}?edit=1`}>
              {t("admin.common.edit")}
            </Link>
            <form action={setAssetStatusAction.bind(null, type, id)}>
              <input type="hidden" name="status" value={asset.status === "active" ? "inactive" : "active"} />
              <button type="submit" className={asset.status === "active" ? btnDanger : btnPrimary}>
                {t(asset.status === "active" ? "admin.common.deactivate" : "admin.common.activate")}
              </button>
            </form>
          </>
        }
      />
      {searchParams.saved ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      {editing ? (
        <Panel title={t("admin.assets.editAsset")} className="mb-4">
          <AssetForm t={t} asset={asset} action={saveAssetAction.bind(null, type, id)} />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("admin.assets.latest")}>
          {latest.length === 0 ? (
            <Empty>{t("admin.assets.noInspections")}</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
              {latest.map(({ n, last }) => (
                <div key={n} className="rounded-md border border-border px-2 py-1.5 text-[12px]" data-status={last.overall_status}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">#{n}</span>
                    <span className="status-dot" />
                  </div>
                  <div className="text-text-2">
                    {getPosition(n).abbreviation} · {last.psi ?? "—"} PSI · {last.tread_32nds ?? "—"}/32
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t("admin.assets.positionTrend")}>
          {series.length === 0 ? (
            <Empty>{t("admin.assets.noInspections")}</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {series
                .filter((s) => s.points.length > 1)
                .slice(0, 6)
                .map((s) => (
                  <div key={s.tire_number}>
                    <div className="text-[11px] font-semibold text-text-2">
                      #{s.tire_number} {getPosition(s.tire_number).abbreviation}
                    </div>
                    <LineChart points={s.points.map((p) => ({ x: p.submitted_at.slice(0, 10), y: p.tread_32nds }))} unit="/32" height={90} decimals={0} />
                  </div>
                ))}
              {series.every((s) => s.points.length <= 1) ? <p className="col-span-2 text-[12px] text-text-3">{t("admin.common.noResults")}</p> : null}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t("admin.assets.inspections")} className="mt-4">
        {inspections.length === 0 ? (
          <Empty>{t("admin.assets.noInspections")}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.reports.columns.date")}</Th>
                <Th>{t("admin.reports.columns.driver")}</Th>
                <Th>{t(type === "truck" ? "admin.reports.columns.trailer" : "admin.reports.columns.truck")}</Th>
                <Th right>{t("admin.reports.columns.odometer")}</Th>
                <Th right>{t("admin.reports.columns.red")}</Th>
                <Th right>{t("admin.reports.columns.yellow")}</Th>
                <Th right>{t("report.damaged")}</Th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2">
                  <Td>
                    <Link className="font-semibold text-accent" href={`/admin/reports/${i.id}`}>
                      {fmtDate(i.submitted_at, locale)}
                    </Link>
                  </Td>
                  <Td>{i.driver_name ?? "—"}</Td>
                  <Td>{i.other_unit ?? "—"}</Td>
                  <Td right>{i.odometer !== null ? Math.round(i.odometer).toLocaleString(locale) : i.hubometer !== null ? Math.round(i.hubometer).toLocaleString(locale) : "—"}</Td>
                  <Td right>{i.red}</Td>
                  <Td right>{i.yellow}</Td>
                  <Td right>{i.damaged}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
