import Link from "next/link";
import { Empty, PageHeader, Panel, Table, Td, Th, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { listBrands, listModels, listVariants } from "@/lib/catalog/repo";
import { listCatalogProviders } from "@/lib/catalog/provider";
import { saveBrandAction, saveModelAction, saveVariantAction } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const APPS = ["steer", "drive", "trailer", "all_position"] as const;

export default async function CatalogPage({ searchParams }: PageProps<"/admin/tires/catalog">) {
  const session = await requireAdmin();
  const { t } = await getServerTranslator();
  const sp = await searchParams;
  const tab = (["brands", "models", "variants"].includes(one(sp.tab)) ? one(sp.tab) : "variants") as "brands" | "models" | "variants";
  const q = one(sp.q);
  const brandFilter = one(sp.brand) || null;
  const modelFilter = one(sp.model) || null;
  const editing = one(sp.edit) || null;
  const adding = one(sp.add) === "1";
  const canEdit = canConfigure(session);
  const canShared = session.user.isSuperAdmin;

  const [brands, models, variants] = await Promise.all([
    listBrands(session.scope, { includeDiscontinued: true }),
    listModels(session.scope, { includeDiscontinued: true, brandId: tab === "models" ? brandFilter : null }),
    tab === "variants" ? listVariants(session.scope, { q, brandId: brandFilter, modelId: modelFilter, includeDiscontinued: true, limit: 300 }) : Promise.resolve([]),
  ]);
  const editBrand = tab === "brands" && editing ? brands.find((b) => b.id === editing) : null;
  const editModel = tab === "models" && editing ? models.find((m) => m.id === editing) : null;
  const editVariant = tab === "variants" && editing ? variants.find((v) => v.id === editing) : null;
  const scopeField = (row?: { tenant_id: string | null } | null) => (
    <label className="text-[12px] text-text-2">
      {t("admin.catalog.status")}
      <select name="scope" defaultValue={row ? (row.tenant_id ? "tenant" : "shared") : canShared ? "shared" : "tenant"} className={selectCls} disabled={!!row}>
        {canShared ? <option value="shared">{t("admin.catalog.scopeShared")}</option> : null}
        <option value="tenant">{t("admin.catalog.scopeTenant")}</option>
      </select>
    </label>
  );
  const tabLink = (k: typeof tab, label: string) => (
    <Link href={`/admin/tires/catalog?tab=${k}`} className={"rounded-md px-3 py-1.5 text-[13px] font-semibold " + (tab === k ? "bg-accent-soft text-accent" : "text-text-2 hover:bg-surface-3")}>
      {label}
    </Link>
  );
  const scopeBadge = (tenantId: string | null) => <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-3">{t(tenantId ? "admin.catalog.custom" : "admin.catalog.shared")}</span>;

  return (
    <>
      <PageHeader
        title={t("admin.catalog.title")}
        subtitle={t("admin.catalog.hint")}
        actions={
          <>
            <Link className={btnSecondary} href="/admin/tires">
              ‹ {t("admin.nav.tires")}
            </Link>
            {canEdit ? (
              <Link className={btnPrimary} href={`/admin/tires/catalog?tab=${tab}&add=1`} data-testid="catalog-add">
                + {t(tab === "brands" ? "admin.catalog.addBrand" : tab === "models" ? "admin.catalog.addModel" : "admin.catalog.addVariant")}
              </Link>
            ) : null}
          </>
        }
      />
      {one(sp.error) ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{one(sp.error) === "not_allowed" ? t("admin.common.notAllowed") : t("admin.common.error", { message: one(sp.error) })}</div> : null}
      {one(sp.saved) ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      <div className="mb-3 flex items-center gap-1">
        {tabLink("brands", `${t("admin.catalog.brands")} · ${brands.length}`)}
        {tabLink("models", t("admin.catalog.models"))}
        {tabLink("variants", t("admin.catalog.variants"))}
        <span className="ml-auto text-[11px] text-text-3">
          {t("admin.catalog.provider")}: {listCatalogProviders().map((p) => p.label).join(", ")}
        </span>
      </div>

      {/* ---------------- BRANDS ---------------- */}
      {tab === "brands" ? (
        <>
          {(adding || editBrand) && canEdit ? (
            <Panel title={editBrand ? t("admin.common.edit") : t("admin.catalog.addBrand")} className="mb-4">
              <form action={saveBrandAction.bind(null, editBrand?.id ?? null)} className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.brands")} *<input name="name" required defaultValue={editBrand?.name ?? ""} className={inputCls} data-testid="brand-name" />
                </label>
                <label className="text-[12px] text-text-2">
                  Country<input name="country" defaultValue={editBrand?.country ?? ""} className={inputCls} maxLength={2} />
                </label>
                <label className="text-[12px] text-text-2">
                  Website<input name="website" defaultValue={editBrand?.website ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.status")}
                  <select name="status" defaultValue={editBrand?.status ?? "active"} className={selectCls}>
                    <option value="active">{t("admin.catalog.active")}</option>
                    <option value="discontinued">{t("admin.catalog.discontinued")}</option>
                  </select>
                </label>
                {scopeField(editBrand)}
                <div className="col-span-2 flex items-end gap-2 md:col-span-5">
                  <button type="submit" className={btnPrimary}>
                    {t("admin.common.save")}
                  </button>
                  <Link className={btnSecondary} href="/admin/tires/catalog?tab=brands">
                    {t("admin.common.cancel")}
                  </Link>
                </div>
              </form>
            </Panel>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.catalog.brands")}</Th>
                <Th>Country</Th>
                <Th right>{t("admin.catalog.models")}</Th>
                <Th>{t("admin.catalog.provider")}</Th>
                <Th>{t("admin.catalog.status")}</Th>
                <Th>{t("admin.common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id} className={b.status === "discontinued" ? "opacity-60" : ""}>
                  <Td className="font-semibold">
                    {b.name} {scopeBadge(b.tenant_id)}
                  </Td>
                  <Td>{b.country ?? "—"}</Td>
                  <Td right>
                    <Link className="text-accent" href={`/admin/tires/catalog?tab=models&brand=${b.id}`}>
                      {b.models_count}
                    </Link>
                  </Td>
                  <Td>{b.provider}</Td>
                  <Td>{t(b.status === "active" ? "admin.catalog.active" : "admin.catalog.discontinued")}</Td>
                  <Td>{canEdit && (b.tenant_id || canShared) ? <Link className={btnSecondary + " h-7 px-2 text-[12px]"} href={`/admin/tires/catalog?tab=brands&edit=${b.id}`}>{t("admin.common.edit")}</Link> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}

      {/* ---------------- MODELS ---------------- */}
      {tab === "models" ? (
        <>
          {(adding || editModel) && canEdit ? (
            <Panel title={editModel ? t("admin.common.edit") : t("admin.catalog.addModel")} className="mb-4">
              <form action={saveModelAction.bind(null, editModel?.id ?? null)} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.brands")} *
                  <select name="brand_id" required defaultValue={editModel?.brand_id ?? brandFilter ?? ""} className={selectCls}>
                    <option value="">—</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.models")} *<input name="name" required defaultValue={editModel?.name ?? ""} className={inputCls} data-testid="model-name" />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.application")}
                  <select name="application" defaultValue={editModel?.application ?? "all_position"} className={selectCls}>
                    {APPS.map((a) => (
                      <option key={a} value={a}>
                        {t(`admin.catalog.applications.${a}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.category")}<input name="category" defaultValue={editModel?.category ?? ""} className={inputCls} placeholder="long haul" />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.status")}
                  <select name="status" defaultValue={editModel?.status ?? "active"} className={selectCls}>
                    <option value="active">{t("admin.catalog.active")}</option>
                    <option value="discontinued">{t("admin.catalog.discontinued")}</option>
                  </select>
                </label>
                {scopeField(editModel)}
                <div className="col-span-2 flex items-end gap-2 md:col-span-6">
                  <button type="submit" className={btnPrimary}>
                    {t("admin.common.save")}
                  </button>
                  <Link className={btnSecondary} href="/admin/tires/catalog?tab=models">
                    {t("admin.common.cancel")}
                  </Link>
                </div>
              </form>
            </Panel>
          ) : null}
          <form method="get" className="mb-3 flex gap-2">
            <input type="hidden" name="tab" value="models" />
            <select name="brand" defaultValue={brandFilter ?? ""} className={selectCls + " h-9 w-52"}>
              <option value="">{t("admin.catalog.brands")}: {t("admin.common.all")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className={btnSecondary} type="submit">
              {t("admin.common.apply")}
            </button>
          </form>
          {models.length === 0 ? (
            <Empty>{t("admin.common.noResults")}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.catalog.brands")}</Th>
                  <Th>{t("admin.catalog.models")}</Th>
                  <Th>{t("admin.catalog.application")}</Th>
                  <Th>{t("admin.catalog.category")}</Th>
                  <Th right>{t("admin.catalog.variants")}</Th>
                  <Th>{t("admin.catalog.status")}</Th>
                  <Th>{t("admin.common.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className={m.status === "discontinued" ? "opacity-60" : ""}>
                    <Td>{m.brand_name}</Td>
                    <Td className="font-semibold">
                      {m.name} {scopeBadge(m.tenant_id)}
                    </Td>
                    <Td>{t(`admin.catalog.applications.${m.application}`)}</Td>
                    <Td>{m.category ?? "—"}</Td>
                    <Td right>
                      <Link className="text-accent" href={`/admin/tires/catalog?tab=variants&model=${m.id}`}>
                        {m.variants_count}
                      </Link>
                    </Td>
                    <Td>{t(m.status === "active" ? "admin.catalog.active" : "admin.catalog.discontinued")}</Td>
                    <Td>{canEdit && (m.tenant_id || canShared) ? <Link className={btnSecondary + " h-7 px-2 text-[12px]"} href={`/admin/tires/catalog?tab=models&edit=${m.id}&brand=${brandFilter ?? ""}`}>{t("admin.common.edit")}</Link> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : null}

      {/* ---------------- VARIANTS ---------------- */}
      {tab === "variants" ? (
        <>
          {(adding || editVariant) && canEdit ? (
            <Panel title={editVariant ? t("admin.common.edit") : t("admin.catalog.addVariant")} className="mb-4">
              <form action={saveVariantAction.bind(null, editVariant?.id ?? null)} className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="col-span-2 text-[12px] text-text-2">
                  {t("admin.catalog.models")} *
                  <select name="model_id" required defaultValue={editVariant?.model_id ?? modelFilter ?? ""} className={selectCls} data-testid="variant-model">
                    <option value="">—</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brand_name} {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-text-2">
                  Size *<input name="size" required defaultValue={editVariant?.size ?? ""} className={inputCls + " font-mono"} placeholder="295/75R22.5" data-testid="variant-size" />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.partNumber")}<input name="part_number" defaultValue={editVariant?.part_number ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.application")}
                  <select name="application" defaultValue={editVariant?.application ?? "all_position"} className={selectCls}>
                    {APPS.map((a) => (
                      <option key={a} value={a}>
                        {t(`admin.catalog.applications.${a}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.loadRange")}<input name="load_range" defaultValue={editVariant?.load_range ?? ""} className={inputCls} maxLength={2} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.ply")}<input name="ply_rating" type="number" defaultValue={editVariant?.ply_rating ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.liSingle")}<input name="load_index_single" type="number" defaultValue={editVariant?.load_index_single ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.liDual")}<input name="load_index_dual" type="number" defaultValue={editVariant?.load_index_dual ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.speed")}<input name="speed_rating" defaultValue={editVariant?.speed_rating ?? ""} className={inputCls} maxLength={2} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.maxPsi")}<input name="max_cold_psi" type="number" defaultValue={editVariant?.max_cold_psi ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.origTread")}<input name="original_tread_32nds" type="number" step="0.5" defaultValue={editVariant?.original_tread_32nds ?? ""} className={inputCls} />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.rim")}<input name="rim_size" defaultValue={editVariant?.rim_size ?? ""} className={inputCls} placeholder="22.5x8.25" />
                </label>
                <label className="text-[12px] text-text-2">
                  {t("admin.catalog.status")}
                  <select name="status" defaultValue={editVariant?.status ?? "active"} className={selectCls}>
                    <option value="active">{t("admin.catalog.active")}</option>
                    <option value="discontinued">{t("admin.catalog.discontinued")}</option>
                  </select>
                </label>
                {scopeField(editVariant)}
                <div className="col-span-2 flex items-end gap-2 md:col-span-6">
                  <button type="submit" className={btnPrimary} data-testid="variant-save">
                    {t("admin.common.save")}
                  </button>
                  <Link className={btnSecondary} href="/admin/tires/catalog?tab=variants">
                    {t("admin.common.cancel")}
                  </Link>
                </div>
              </form>
            </Panel>
          ) : null}
          <form method="get" className="mb-3 flex flex-wrap gap-2">
            <input type="hidden" name="tab" value="variants" />
            <input name="q" defaultValue={q} placeholder={t("admin.common.search")} className={inputCls + " h-9 w-56"} />
            <select name="brand" defaultValue={brandFilter ?? ""} className={selectCls + " h-9 w-48"}>
              <option value="">{t("admin.catalog.brands")}: {t("admin.common.all")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {modelFilter ? <input type="hidden" name="model" value={modelFilter} /> : null}
            <button className={btnSecondary} type="submit">
              {t("admin.common.apply")}
            </button>
          </form>
          {variants.length === 0 ? (
            <Empty>{t("admin.common.noResults")}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.catalog.brands")}</Th>
                  <Th>{t("admin.catalog.models")}</Th>
                  <Th>Size</Th>
                  <Th>{t("admin.catalog.application")}</Th>
                  <Th>{t("admin.catalog.loadRange")}</Th>
                  <Th right>{t("admin.catalog.liSingle")}/{t("admin.catalog.liDual")}</Th>
                  <Th right>{t("admin.catalog.maxPsi")}</Th>
                  <Th right>{t("admin.catalog.origTread")}</Th>
                  <Th>{t("admin.catalog.rim")}</Th>
                  <Th>{t("admin.catalog.status")}</Th>
                  <Th>{t("admin.common.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className={v.status === "discontinued" ? "opacity-60" : ""}>
                    <Td>{v.brand_name}</Td>
                    <Td className="font-semibold">
                      {v.model_name} {scopeBadge(v.tenant_id)}
                    </Td>
                    <Td mono>{v.size}</Td>
                    <Td>{t(`admin.catalog.applications.${v.application}`)}</Td>
                    <Td>{v.load_range ?? "—"}</Td>
                    <Td right>
                      {v.load_index_single ?? "—"}/{v.load_index_dual ?? "—"}
                    </Td>
                    <Td right>{v.max_cold_psi ?? "—"}</Td>
                    <Td right>{v.original_tread_32nds ?? "—"}</Td>
                    <Td>{v.rim_size ?? "—"}</Td>
                    <Td>{t(v.status === "active" ? "admin.catalog.active" : "admin.catalog.discontinued")}</Td>
                    <Td>{canEdit && (v.tenant_id || canShared) ? <Link className={btnSecondary + " h-7 px-2 text-[12px]"} href={`/admin/tires/catalog?tab=variants&edit=${v.id}&brand=${brandFilter ?? ""}`}>{t("admin.common.edit")}</Link> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : null}
    </>
  );
}
