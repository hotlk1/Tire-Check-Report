import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LineChart } from "@/components/admin/charts";
import { Empty, PageHeader, Panel, Table, Td, Th, btnDanger, btnPrimary, btnSecondary, fmtDate } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { assetInspections, assetPositionSeries, getAsset } from "@/lib/repos/admin/assets";
import { publishConfigurationAction, saveAssetAction, setAssetStatusAction } from "@/app/admin/(app)/assets-actions";
import { assetBase, EXTRA_KINDS } from "@/lib/equipment/paths";
import type { ComponentKind } from "@/lib/equipment/types";
import { canConfigure } from "@/lib/auth/session";
import { listConfigurations } from "@/lib/repos/equipment";
import { listTireAssets } from "@/lib/repos/tire-assets";
import type { MessageKey } from "@/i18n";
import { AssetForm } from "./AssetForm";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { MountedTiresPanel } from "./MountedTiresPanel";

export async function AssetDetailPage({ type, id, searchParams }: { type: ComponentKind | "extra"; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  if (!z.string().uuid().safeParse(id).success) notFound();
  const asset = await getAsset(session.scope, id);
  if (!asset) notFound();
  if (type === "extra" ? !EXTRA_KINDS.includes(asset.type) : asset.type !== type) notFound();
  const kind = asset.type;
  const [inspections, series, configurations, mounted] = await Promise.all([assetInspections(session.scope, id), assetPositionSeries(session.scope, id), listConfigurations(session.scope, id), listTireAssets(session.scope, { assetId: id, pageSize: 200 })]);
  const base = assetBase(kind);
  const latest = series.map((s) => ({ n: s.tire_number, key: s.position_key, last: s.points[s.points.length - 1] })).filter((x) => x.last);
  const editing = searchParams.edit === "1";
  const kindLabel = kind === "truck" ? t("admin.assets.trucks") : kind === "trailer" ? t("admin.assets.trailers") : t(`equipment.kinds.${kind}` as MessageKey);

  return (
    <>
      <PageHeader
        title={asset.unit_number}
        subtitle={[asset.year, asset.make, asset.model, asset.license_plate, asset.vin].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link className={btnSecondary} href={EXTRA_KINDS.includes(kind) ? `${base}?kind=${kind}` : base}>
              ‹ {kindLabel}
            </Link>
            <Link className={btnSecondary} href={`${base}/${id}?edit=1`}>
              {t("admin.common.edit")}
            </Link>
            <form action={setAssetStatusAction.bind(null, kind, id)}>
              <input type="hidden" name="status" value={asset.status === "active" ? "inactive" : "active"} />
              <button type="submit" className={asset.status === "active" ? btnDanger : btnPrimary}>
                {t(asset.status === "active" ? "admin.common.deactivate" : "admin.common.activate")}
              </button>
            </form>
          </>
        }
      />
      {searchParams.saved ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      {searchParams.error ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{searchParams.error === "not_allowed" ? t("admin.common.notAllowed") : t("admin.common.error", { message: String(searchParams.error) })}</div> : null}
      {editing ? (
        <Panel title={t("admin.assets.editAsset")} className="mb-4">
          <AssetForm t={t} asset={asset} action={saveAssetAction.bind(null, kind, id)} />
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ConfigurationPanel t={t} locale={locale} kind={kind} configurations={configurations} canEdit={canConfigure(session)} action={publishConfigurationAction.bind(null, kind, id)} />
        <MountedTiresPanel t={t} assetId={id} kind={kind} config={configurations[0]?.config ?? null} tires={mounted.rows} canEdit={canConfigure(session)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title={t("admin.assets.latest")}>
          {latest.length === 0 ? (
            <Empty>{t("admin.assets.noInspections")}</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
              {latest.map(({ n, key, last }) => (
                <div key={key ?? n} className="rounded-md border border-border px-2 py-1.5 text-[12px]" data-status={last.overall_status}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{key ?? `#${n}`}</span>
                    <span className="status-dot" />
                  </div>
                  <div className="text-text-2">
                    {last.psi ?? "—"} PSI · {last.tread_32nds ?? "—"}/32
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
                  <div key={s.position_key ?? s.tire_number}>
                    <div className="text-[11px] font-semibold text-text-2">
                      {s.position_key ?? `#${s.tire_number}`}
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
                <Th>{t(kind === "truck" ? "admin.reports.columns.trailer" : "admin.reports.columns.truck")}</Th>
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
