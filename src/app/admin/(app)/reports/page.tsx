import Link from "next/link";
import { Empty, fmtDate, PageHeader, Pagination, Table, Td, Th, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { listReports } from "@/lib/repos/admin/reports";
import { listDrivers } from "@/lib/repos/admin/drivers";

function d(v: string | string[] | undefined): Date | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? null : x;
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const status = (["red", "yellow", "issues"].includes(one(sp.status)) ? one(sp.status) : "all") as "red" | "yellow" | "issues" | "all";
  const to = d(sp.to);
  const filters = { from: d(sp.from), to: to ? new Date(to.getTime() + 86_400_000) : null, driverId: one(sp.driver) || null, assetId: one(sp.asset) || null, status, includeDeleted: one(sp.deleted) === "1", page, pageSize: 50 };
  const [{ rows, total }, drivers] = await Promise.all([listReports(session.scope, filters), listDrivers(session.scope, { status: "all" })]);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) u.set(k, v);
    u.set("page", String(p));
    return `/admin/reports?${u.toString()}`;
  };

  return (
    <>
      <PageHeader title={t("admin.reports.title")} subtitle={t("admin.common.total", { count: total })} />
      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <label className="text-[12px] text-text-2">
          {t("admin.common.from")}
          <input type="date" name="from" defaultValue={one(sp.from)} className={inputCls + " h-9 w-40"} />
        </label>
        <label className="text-[12px] text-text-2">
          {t("admin.common.to")}
          <input type="date" name="to" defaultValue={one(sp.to)} className={inputCls + " h-9 w-40"} />
        </label>
        <label className="text-[12px] text-text-2">
          {t("admin.reports.filters.driver")}
          <select name="driver" defaultValue={one(sp.driver)} className={selectCls + " h-9 w-44"}>
            <option value="">{t("admin.common.all")}</option>
            {drivers.map((dr) => (
              <option key={dr.id} value={dr.id}>
                {dr.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-text-2">
          {t("admin.reports.filters.status")}
          <select name="status" defaultValue={status} className={selectCls + " h-9 w-40"}>
            <option value="all">{t("admin.common.all")}</option>
            <option value="issues">{t("admin.reports.onlyIssues")}</option>
            <option value="red">{t("admin.reports.columns.red")}</option>
            <option value="yellow">{t("admin.reports.columns.yellow")}</option>
          </select>
        </label>
        <label className="flex items-center gap-1 pb-2 text-[12px] text-text-2">
          <input type="checkbox" name="deleted" value="1" defaultChecked={one(sp.deleted) === "1"} /> {t("admin.reports.deleted")}
        </label>
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
              <Th>{t("admin.reports.columns.date")}</Th>
              <Th>{t("admin.reports.columns.driver")}</Th>
              <Th>{t("admin.reports.columns.truck")}</Th>
              <Th>{t("admin.reports.columns.trailer")}</Th>
              <Th right>{t("admin.reports.columns.odometer")}</Th>
              <Th right>{t("admin.reports.columns.red")}</Th>
              <Th right>{t("admin.reports.columns.yellow")}</Th>
              <Th right>{t("admin.reports.columns.photos")}</Th>
              <Th>{t("admin.reports.columns.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={"hover:bg-surface-2 " + (r.status === "deleted" ? "opacity-50" : "")}>
                <Td>
                  <Link className="font-semibold text-accent" href={`/admin/reports/${r.id}`}>
                    {fmtDate(r.submitted_at, locale)}
                  </Link>
                </Td>
                <Td>{r.driver_name ?? "—"}</Td>
                <Td>{r.truck_id ? <Link className="text-accent" href={`/admin/trucks/${r.truck_id}`}>{r.truck_unit}</Link> : "—"}</Td>
                <Td>{r.trailer_id ? <Link className="text-accent" href={`/admin/trailers/${r.trailer_id}`}>{r.trailer_unit}</Link> : "—"}</Td>
                <Td right>{r.odometer !== null ? Math.round(r.odometer).toLocaleString(locale) : "—"}</Td>
                <Td right>
                  <span style={{ color: r.red ? "var(--status-red)" : undefined, fontWeight: r.red ? 700 : 400 }}>{r.red}</span>
                </Td>
                <Td right>
                  <span style={{ color: r.yellow ? "var(--status-yellow)" : undefined, fontWeight: r.yellow ? 700 : 400 }}>{r.yellow}</span>
                </Td>
                <Td right>{r.photos_uploaded}</Td>
                <Td>
                  {r.status === "deleted" ? t("admin.reports.deleted") : r.status === "pending_photos" ? <span className="rounded-md bg-status-red-soft px-1.5 py-0.5 text-[11px] font-semibold text-status-red">{t("admin.reports.pendingPhotos")}</span> : r.edited_at ? t("admin.reports.edited") : "✓"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={50} hrefFor={qs} label={t("admin.common.page", { page, pages: Math.max(1, Math.ceil(total / 50)) })} />
    </>
  );
}
