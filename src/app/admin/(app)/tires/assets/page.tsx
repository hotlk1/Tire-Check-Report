import Link from "next/link";
import { Empty, fmtDate, PageHeader, Pagination, Panel, Table, Td, Th, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { assetBase } from "@/lib/equipment/paths";
import { listTireAssets, type TireAssetState } from "@/lib/repos/tire-assets";
import { registerTireAction } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATES: TireAssetState[] = ["mounted", "spare", "storage", "unassigned", "damaged", "removed", "disposed", "lost"];

export default async function TireAssetsPage({ searchParams }: PageProps<"/admin/tires/assets">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const state = (STATES.includes(one(sp.state) as TireAssetState) ? one(sp.state) : "all") as TireAssetState | "all";
  const { rows, total } = await listTireAssets(session.scope, { state, assetId: one(sp.asset) || null, q: one(sp.q), page, pageSize: 50 });
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) u.set(k, v);
    u.set("page", String(p));
    return `/admin/tires/assets?${u.toString()}`;
  };
  return (
    <>
      <PageHeader
        title={t("admin.tireAssets.title")}
        subtitle={`${t("admin.tireAssets.subtitle")} · ${t("admin.common.total", { count: total })}`}
        actions={
          <>
            <Link className={btnSecondary} href="/admin/tires">‹ {t("admin.tires.title")}</Link>
            {canConfigure(session) ? <Link className={btnSecondary} href="/admin/tires/assets?register=1" data-testid="register-tire">+ {t("admin.tireAssets.register")}</Link> : null}
          </>
        }
      />
      {one(sp.saved) ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      {one(sp.error) ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{one(sp.error) === "not_allowed" ? t("admin.common.notAllowed") : t("admin.common.error", { message: one(sp.error) })}</div> : null}
      {one(sp.register) === "1" ? (
        <Panel title={t("admin.tireAssets.register")} className="mb-4">
          <p className="mb-2 text-[12px] text-text-3">{t("admin.tireAssets.registerHint")}</p>
          <form action={registerTireAction} className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <input name="make" placeholder={t("admin.assets.make")} className={inputCls} data-testid="tire-make" />
            <input name="model" placeholder={t("admin.assets.model")} className={inputCls} />
            <input name="size" placeholder={t("tire.size")} className={inputCls} />
            <input name="serial" placeholder={t("admin.tireAssets.serial")} className={inputCls} />
            <input name="storageLocation" placeholder={t("admin.tireAssets.storageLocation")} className={inputCls} />
            <button type="submit" className={btnPrimary}>{t("admin.common.save")}</button>
          </form>
        </Panel>
      ) : null}
      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <input name="q" defaultValue={one(sp.q)} placeholder={t("admin.common.search")} className={inputCls + " h-9 w-56"} />
        <select name="state" defaultValue={state} className={selectCls + " h-9 w-44"}>
          <option value="all">{t("admin.common.all")}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>{t(`admin.tireAssets.states.${s}`)}</option>
          ))}
        </select>
        {one(sp.asset) ? <input type="hidden" name="asset" value={one(sp.asset)} /> : null}
        <button className={btnSecondary} type="submit">{t("admin.common.apply")}</button>
      </form>
      {rows.length === 0 ? (
        <Empty>{t("admin.tireAssets.noTires")}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.tireAssets.code")}</Th>
              <Th>{t("admin.tireAssets.state")}</Th>
              <Th>{t("admin.assets.make")}</Th>
              <Th>{t("admin.tireAssets.location")}</Th>
              <Th right>{t("admin.tireAssets.lastReading")}</Th>
              <Th>{t("admin.common.created")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <Td><Link className="font-mono font-semibold text-accent" href={`/admin/tires/assets/${r.id}`}>{r.code}</Link>{r.serial ? <span className="ml-1 text-[11px] text-text-3">{r.serial}</span> : null}</Td>
                <Td>{t(`admin.tireAssets.states.${r.state}`)}</Td>
                <Td>{r.variant_label ?? ([r.make, r.model, r.size].filter(Boolean).join(" ") || "—")}</Td>
                <Td>{r.current_asset_id ? <Link className="text-accent" href={`${assetBase(r.current_asset_type ?? "truck")}/${r.current_asset_id}`}>{r.current_unit} · {r.current_position_key}</Link> : r.storage_location ?? "—"}</Td>
                <Td right>{r.last_tread_32nds !== null ? `${r.last_tread_32nds}/32 · ${r.last_psi ?? "—"} PSI` : "—"}</Td>
                <Td>{fmtDate(r.created_at, locale, false)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} total={total} pageSize={50} hrefFor={qs} label={t("admin.common.page", { page, pages: Math.max(1, Math.ceil(total / 50)) })} />
    </>
  );
}
