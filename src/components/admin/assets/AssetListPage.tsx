import Link from "next/link";
import { Empty, PageHeader, Panel, Table, Td, Th, btnSecondary, daysSince, fmtDate, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { listAssets } from "@/lib/repos/admin/assets";
import { saveAssetAction } from "@/app/admin/(app)/assets-actions";
import { assetBase, EXTRA_KINDS } from "@/lib/equipment/paths";
import type { ComponentKind } from "@/lib/equipment/types";
import type { MessageKey } from "@/i18n";
import { AssetForm } from "./AssetForm";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function AssetListPage({ type, searchParams }: { type: ComponentKind; searchParams: Record<string, string | string[] | undefined> }) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const base = assetBase(type);
  const kindLabel = t(`equipment.kinds.${type}` as MessageKey);
  const extra = EXTRA_KINDS.includes(type);
  const title = type === "truck" ? t("admin.assets.trucks") : type === "trailer" ? t("admin.assets.trailers") : t("admin.assets.equipment");
  const addLabel = type === "truck" ? t("admin.assets.addTruck") : type === "trailer" ? t("admin.assets.addTrailer") : t("admin.assets.addKind", { kind: kindLabel });
  const status = (["active", "inactive"].includes(one(searchParams.status)) ? one(searchParams.status) : "all") as "active" | "inactive" | "all";
  const dueDays = Number(session.tenant?.settings?.inspectionDueDays) || 7;
  const rows = await listAssets(session.scope, type, { q: one(searchParams.q), status, due: one(searchParams.due) === "1", dueDays });
  const showAdd = one(searchParams.add) === "1";

  return (
    <>
      <PageHeader
        title={title}
        subtitle={extra ? `${kindLabel} · ${t("admin.common.total", { count: rows.length })}` : t("admin.common.total", { count: rows.length })}
        actions={
          <>
            <button type="button" className={btnSecondary} disabled title={t("admin.assets.syncHint")}>
              {t("admin.assets.sync")}
            </button>
            <Link className={btnSecondary} href={`${base}?${extra ? `kind=${type}&` : ""}add=1`} data-testid="add-asset">
              + {addLabel}
            </Link>
          </>
        }
      />
      {one(searchParams.error) ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{t("admin.common.error", { message: one(searchParams.error) })}</div> : null}
      {showAdd ? (
        <Panel title={addLabel} className="mb-4">
          <AssetForm t={t} action={saveAssetAction.bind(null, type, null)} />
        </Panel>
      ) : null}
      {extra ? (
        <div className="mb-3 flex gap-1">
          {EXTRA_KINDS.map((k) => (
            <Link key={k} href={`${base}?kind=${k}`} className={"rounded-md px-2.5 py-1 text-[12px] font-semibold " + (k === type ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-3")} data-testid={`kind-${k}`}>
              {t(`equipment.kinds.${k}` as MessageKey)}
            </Link>
          ))}
        </div>
      ) : null}
      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        {extra ? <input type="hidden" name="kind" value={type} /> : null}
        <input name="q" defaultValue={one(searchParams.q)} placeholder={t("admin.common.search")} className={inputCls + " h-9 w-56"} />
        <select name="status" defaultValue={status} className={selectCls + " h-9 w-36"}>
          <option value="all">{t("admin.common.all")}</option>
          <option value="active">{t("admin.common.active")}</option>
          <option value="inactive">{t("admin.common.inactive")}</option>
        </select>
        <label className="flex items-center gap-1 pb-2 text-[12px] text-text-2">
          <input type="checkbox" name="due" value="1" defaultChecked={one(searchParams.due) === "1"} /> {t("admin.dashboard.due")}
        </label>
        <button className={btnSecondary} type="submit">
          {t("admin.common.apply")}
        </button>
      </form>
      {rows.length === 0 ? (
        <Empty>{t("admin.common.noResults")}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.assets.unit")}</Th>
              <Th>{t("admin.assets.make")}</Th>
              <Th>{t("admin.assets.year")}</Th>
              <Th>{t("admin.assets.plate")}</Th>
              <Th>{t("admin.assets.lastInspection")}</Th>
              <Th right>{t("admin.reports.columns.red")}</Th>
              <Th right>{t("admin.reports.columns.yellow")}</Th>
              <Th right>{t("admin.dashboard.inspections")}</Th>
              <Th>{t("admin.common.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const days = daysSince(a.last_inspection_at);
              const due = a.status === "active" && (days === null || days >= dueDays);
              return (
                <tr key={a.id} className={"hover:bg-surface-2 " + (a.status === "inactive" ? "opacity-60" : "")}>
                  <Td>
                    <Link className="font-semibold text-accent" href={`${base}/${a.id}`}>
                      {a.unit_number}
                    </Link>
                  </Td>
                  <Td>{[a.make, a.model].filter(Boolean).join(" ") || "—"}</Td>
                  <Td>{a.year ?? "—"}</Td>
                  <Td>{a.license_plate ?? "—"}</Td>
                  <Td>
                    <span style={{ color: due ? "var(--status-yellow)" : undefined, fontWeight: due ? 600 : 400 }}>
                      {a.last_inspection_at ? `${fmtDate(a.last_inspection_at, locale, false)} (${t("admin.assets.daysAgo", { days: days ?? 0 })})` : t("admin.assets.never")}
                    </span>
                  </Td>
                  <Td right>{a.last_red ?? "—"}</Td>
                  <Td right>{a.last_yellow ?? "—"}</Td>
                  <Td right>{a.inspections_count}</Td>
                  <Td>{t(a.status === "active" ? "admin.common.active" : "admin.common.inactive")}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
