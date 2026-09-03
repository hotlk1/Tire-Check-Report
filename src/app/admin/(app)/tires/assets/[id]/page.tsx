import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Empty, fmtDate, PageHeader, Panel, Table, Td, Th, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { assetBase } from "@/lib/equipment/paths";
import { defaultConfigFor } from "@/lib/equipment/templates";
import { wheelPositionsOf } from "@/lib/equipment/types";
import { withScope } from "@/lib/db/client";
import { currentConfiguration } from "@/lib/repos/equipment";
import { getTireAsset, tireAssetEvents, tireAssetInspections } from "@/lib/repos/tire-assets";
import { mountTireAction, setTireStateAction } from "../actions";

export default async function TireAssetPage({ params, searchParams }: PageProps<"/admin/tires/assets/[id]">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const tire = await getTireAsset(session.scope, id);
  if (!tire) notFound();
  const [events, inspections, units] = await Promise.all([
    tireAssetEvents(session.scope, id),
    tireAssetInspections(session.scope, id),
    withScope(session.scope, async (tx) => {
      const assets = await tx<{ id: string; unit_number: string; type: string }[]>`select id, unit_number, type::text as type from assets where tenant_id = ${session.scope.tenantId} and status = 'active' order by type, unit_number limit 300`;
      const out: { id: string; unit: string; type: string; positions: string[] }[] = [];
      for (const a of assets) {
        const cfg = (await currentConfiguration(tx, a.id))?.config ?? defaultConfigFor(a.type as "truck");
        out.push({ id: a.id, unit: a.unit_number, type: a.type, positions: [...cfg.axles.flatMap((x) => wheelPositionsOf(x).map((w) => w.key)), ...cfg.spares.map((s) => s.key)] });
      }
      return out;
    }),
  ]);
  const canEdit = canConfigure(session);
  const retired = tire.state === "disposed" || tire.state === "lost";
  const label = tire.variant_label ?? ([tire.make, tire.model, tire.size].filter(Boolean).join(" ") || "—");

  return (
    <>
      <PageHeader
        title={`${tire.code} · ${label}`}
        subtitle={`${t(`admin.tireAssets.states.${tire.state}`)}${tire.current_unit ? ` · ${tire.current_unit} · ${tire.current_position_key}` : ""}${tire.serial ? ` · ${tire.serial}` : ""}`}
        actions={<Link className={btnSecondary} href="/admin/tires/assets">‹ {t("admin.tireAssets.title")}</Link>}
      />
      {sp.saved ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      {sp.error ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{sp.error === "not_allowed" ? t("admin.common.notAllowed") : t("admin.common.error", { message: String(sp.error) })}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("admin.common.actions")}>
          {canEdit && !retired ? (
            <div className="space-y-3">
              <form action={mountTireAction} className="flex flex-wrap items-end gap-2 text-[12px]" data-testid="mount-form">
                <input type="hidden" name="tireId" value={tire.id} />
                <label className="text-text-2">
                  {t("admin.tireAssets.unit")}
                  <select name="assetId" className={selectCls + " h-9 w-44"} defaultValue={tire.current_asset_id ?? ""} required>
                    <option value="">—</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.unit} ({u.type})</option>
                    ))}
                  </select>
                </label>
                <label className="text-text-2">
                  {t("admin.tireAssets.position")}
                  <input name="positionKey" list="position-keys" className={inputCls + " h-9 w-40"} placeholder="drive-1:LO" defaultValue={tire.current_position_key ?? ""} required />
                  <datalist id="position-keys">
                    {[...new Set(units.flatMap((u) => u.positions))].map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <label className="text-text-2">
                  {t("admin.assets.note")}
                  <input name="note" className={inputCls + " h-9 w-48"} />
                </label>
                <button type="submit" className={btnSecondary}>{tire.current_asset_id ? t("admin.assets.move") : t("admin.tireAssets.mount")}</button>
              </form>
              <div className="flex flex-wrap gap-2">
                {(["unmounted", "damaged", "removed", "lost", "disposed"] as const).filter((s) => s !== tire.state).map((s) => (
                  <form key={s} action={setTireStateAction}>
                    <input type="hidden" name="tireId" value={tire.id} />
                    <input type="hidden" name="state" value={s} />
                    <button type="submit" className={btnSecondary} data-testid={`state-${s}`}>{t(`admin.tireAssets.states.${s}`)}</button>
                  </form>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-text-3">{retired ? t(`admin.tireAssets.states.${tire.state}`) : t("admin.common.notAllowed")}</p>
          )}
        </Panel>
        <Panel title={t("admin.tireAssets.inspections")}>
          {inspections.length === 0 ? (
            <Empty>{t("admin.assets.noInspections")}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("admin.tires.columns.date")}</Th>
                  <Th>{t("admin.tires.columns.unit")}</Th>
                  <Th>{t("admin.tires.columns.position")}</Th>
                  <Th right>{t("admin.tires.columns.psi")}</Th>
                  <Th right>{t("admin.tires.columns.tread")}</Th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((i) => (
                  <tr key={i.inspection_id + i.position_key}>
                    <Td><Link className="text-accent" href={`/admin/reports/${i.inspection_id}#tire-${i.tire_number}`}>{fmtDate(i.submitted_at, locale)}</Link></Td>
                    <Td>{i.unit_number ?? "—"}</Td>
                    <Td>#{i.tire_number} · {i.position_key?.split("/")[1] ?? ""}</Td>
                    <Td right>{i.psi ?? "—"}</Td>
                    <Td right>{i.tread_32nds !== null ? `${i.tread_32nds}/32` : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <Panel title={t("admin.tireAssets.history")} className="mt-4">
        {events.length === 0 ? (
          <Empty>{t("admin.common.noResults")}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.settings.auditColumns.when")}</Th>
                <Th>{t("admin.settings.auditColumns.action")}</Th>
                <Th>{t("admin.tireAssets.location")}</Th>
                <Th>{t("admin.tireAssets.state")}</Th>
                <Th>{t("admin.settings.auditColumns.who")}</Th>
                <Th>{t("admin.assets.note")}</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td>{fmtDate(e.occurred_at, locale)}</Td>
                  <Td>{t(`admin.tireAssets.events.${e.event_type as "mount"}`)}</Td>
                  <Td>
                    {e.from_unit ? `${e.from_unit} · ${e.from_position_key ?? ""} → ` : ""}
                    {e.unit_number ? `${e.unit_number} · ${e.position_key ?? ""}` : "—"}
                  </Td>
                  <Td>{e.from_state ? `${t(`admin.tireAssets.states.${e.from_state as "mounted"}`)} → ` : ""}{e.to_state ? t(`admin.tireAssets.states.${e.to_state as "mounted"}`) : "—"}</Td>
                  <Td>{e.actor_label ?? "—"}{e.inspection_id ? <Link className="ml-1 text-accent" href={`/admin/reports/${e.inspection_id}`}>↗</Link> : null}</Td>
                  <Td>{e.note ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {tire.current_asset_id ? <p className="mt-3 text-[12px]"><Link className="text-accent" href={`${assetBase(tire.current_asset_type ?? "truck")}/${tire.current_asset_id}`}>{tire.current_unit} ›</Link></p> : null}
    </>
  );
}
