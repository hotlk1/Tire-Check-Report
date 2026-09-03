import Link from "next/link";
import { Empty, fmtDate, PageHeader, Pagination, Panel, StatusPill, Table, Td, Th, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { listTireEntries } from "@/lib/repos/admin/tires";
import { TEMPLATES } from "@/lib/equipment/templates";
import { wheelPositionsOf } from "@/lib/equipment/types";

/** Position keys of every built-in template (steer:L, drive-1:LO, axle-3:RI, spare-1, …). */
const POSITION_KEYS = [...new Set(TEMPLATES.flatMap((tpl) => [...tpl.config.axles.flatMap((a) => wheelPositionsOf(a).map((w) => w.key)), ...tpl.config.spares.map((s) => s.key)]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
function d(v: string): Date | null {
  if (!v) return null;
  const x = new Date(v);
  return Number.isNaN(x.getTime()) ? null : x;
}

export default async function TiresPage({ searchParams }: PageProps<"/admin/tires">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const status = (["red", "yellow", "green", "issues"].includes(one(sp.status)) ? one(sp.status) : "all") as "red" | "yellow" | "green" | "issues" | "all";
  const positionKey = POSITION_KEYS.includes(one(sp.position)) ? one(sp.position) : null;
  const to = d(one(sp.to));
  const { rows, total } = await listTireEntries(session.scope, { status, positionKey, assetId: one(sp.asset) || null, from: d(one(sp.from)), to: to ? new Date(to.getTime() + 86_400_000) : null, page, pageSize: 50 });
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) u.set(k, v);
    u.set("page", String(p));
    return `/admin/tires?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        title={t("admin.tires.title")}
        subtitle={`${t("admin.tires.subtitle")} · ${t("admin.common.total", { count: total })}`}
        actions={
          <>
            <Link className={btnSecondary} href="/admin/tires/assets" data-testid="open-tire-assets">
              {t("admin.tireAssets.title")} ›
            </Link>
            <Link className={btnSecondary} href="/admin/tires/catalog" data-testid="open-catalog">
              {t("admin.catalog.title")} ›
            </Link>
          </>
        }
      />
      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <select name="status" defaultValue={status} className={selectCls + " h-9 w-40"}>
          <option value="all">{t("admin.common.all")}</option>
          <option value="issues">{t("admin.reports.onlyIssues")}</option>
          <option value="red">{t("tire.status.red")}</option>
          <option value="yellow">{t("tire.status.yellow")}</option>
          <option value="green">{t("tire.status.green")}</option>
        </select>
        <select name="position" defaultValue={positionKey ?? ""} className={selectCls + " h-9 w-44"}>
          <option value="">{t("admin.tires.positionKey")}: {t("admin.common.all")}</option>
          {POSITION_KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={one(sp.from)} className={inputCls + " h-9 w-40"} />
        <input type="date" name="to" defaultValue={one(sp.to)} className={inputCls + " h-9 w-40"} />
        {one(sp.asset) ? <input type="hidden" name="asset" value={one(sp.asset)} /> : null}
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
              <Th>{t("admin.tires.columns.date")}</Th>
              <Th>{t("admin.tires.columns.unit")}</Th>
              <Th>{t("admin.tires.columns.tire")}</Th>
              <Th>{t("admin.tires.columns.position")}</Th>
              <Th right>{t("admin.tires.columns.psi")}</Th>
              <Th right>{t("admin.tires.columns.tread")}</Th>
              <Th>{t("admin.tires.columns.damage")}</Th>
              <Th>{t("admin.tires.columns.status")}</Th>
              <Th>{t("admin.tires.columns.driver")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td>
                  <Link className="text-accent" href={`/admin/reports/${r.inspection_id}#tire-${r.tire_number}`}>
                    {fmtDate(r.submitted_at, locale)}
                  </Link>
                </Td>
                <Td>{r.unit_number ?? "—"}</Td>
                <Td>#{r.tire_number}{r.tire_code ? <Link className="ml-1 font-mono text-[11px] text-accent" href={`/admin/tires/assets/${r.tire_asset_id}`}>{r.tire_code}</Link> : null}</Td>
                <Td>{r.position_key ? r.position_key.replace("/", " · ") : r.position_code}</Td>
                <Td right>{r.psi ?? "—"}</Td>
                <Td right>{r.tread_32nds !== null ? `${r.tread_32nds}/32` : "—"}</Td>
                <Td>{t(`damage.${r.damage}`)}</Td>
                <Td>
                  <StatusPill status={r.overall_status}>{t(`tire.status.${r.overall_status}`)}</StatusPill>
                  {r.photos ? <span className="ml-1 text-[11px] text-text-3">📷 {r.photos}</span> : null}
                </Td>
                <Td>{r.driver_name ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={50} hrefFor={qs} label={t("admin.common.page", { page, pages: Math.max(1, Math.ceil(total / 50)) })} />
      <Panel title={t("admin.tireAssets.title")} className="mt-4">
        <p className="text-[13px] text-text-2">{t("admin.tireAssets.subtitle")} · <Link className="text-accent" href="/admin/tires/assets">{t("admin.common.view")} ›</Link></p>
      </Panel>
    </>
  );
}
