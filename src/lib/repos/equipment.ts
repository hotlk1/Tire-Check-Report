import "server-only";
import type postgres from "postgres";
import { audit } from "@/lib/audit";
import { withScope, type Scope, type Tx } from "@/lib/db/client";
import type { ComponentSlot, LayoutComponentInput } from "@/lib/equipment/layout";
import { defaultConfigFor, templateByKey } from "@/lib/equipment/templates";
import { validateEquipmentConfig, type ComponentKind, type EquipmentConfig } from "@/lib/equipment/types";
import type { MountedTireInfo } from "@/lib/inspection/draft";

export interface AssetConfigurationRow {
  id: string;
  asset_id: string;
  version: number;
  config: EquipmentConfig;
  template_key: string | null;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
}

/** Current (newest) configuration of an asset, or null when the default template applies. */
export async function currentConfiguration(tx: Tx, assetId: string): Promise<AssetConfigurationRow | null> {
  const rows = await tx<AssetConfigurationRow[]>`
    select c.id, c.asset_id, c.version, c.config, c.template_key, c.note, c.created_at, u.full_name as created_by_name
    from asset_configurations c left join users u on u.id = c.created_by
    where c.asset_id = ${assetId} order by c.version desc limit 1`;
  const row = rows[0];
  if (!row) return null;
  const v = validateEquipmentConfig(row.config);
  return v.ok ? { ...row, config: v.config } : null;
}

export async function listConfigurations(scope: Scope & { tenantId: string }, assetId: string): Promise<AssetConfigurationRow[]> {
  return withScope(scope, (tx) =>
    tx<AssetConfigurationRow[]>`
      select c.id, c.asset_id, c.version, c.config, c.template_key, c.note, c.created_at, u.full_name as created_by_name
      from asset_configurations c left join users u on u.id = c.created_by
      where c.asset_id = ${assetId} and c.tenant_id = ${scope.tenantId} order by c.version desc`,
  );
}

/** Publishes a new immutable configuration version for an asset (admin only; audited). */
export async function publishConfiguration(scope: Scope & { tenantId: string; userId: string }, assetId: string, input: unknown, note: string | null, actorLabel: string) {
  const v = validateEquipmentConfig(input);
  if (!v.ok) throw new Error(v.error);
  return withScope(scope, async (tx) => {
    const [asset] = await tx<{ id: string; type: ComponentKind }[]>`select id, type from assets where id = ${assetId} and tenant_id = ${scope.tenantId}`;
    if (!asset) throw new Error("not_found");
    if (asset.type !== v.config.kind) throw new Error(`configuration kind ${v.config.kind} does not match asset type ${asset.type}`);
    const prev = await currentConfiguration(tx, assetId);
    const version = (prev?.version ?? 0) + 1;
    const [row] = await tx<{ id: string }[]>`insert into asset_configurations (tenant_id, asset_id, version, config, template_key, note, created_by)
      values (${scope.tenantId}, ${assetId}, ${version}, ${tx.json(v.config as unknown as postgres.JSONValue)}, ${v.config.templateKey ?? null}, ${note}, ${scope.userId}) returning id`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "config", entityType: "asset_configuration", entityId: row.id, oldValue: prev ? { asset_id: assetId, version: prev.version, ...prev.config } : { asset_id: assetId, template: "default" }, newValue: { asset_id: assetId, version, note, ...v.config } });
    return { id: row.id, version };
  });
}

export interface ResolvedComponent extends LayoutComponentInput {
  assetType: ComponentKind;
}

/**
 * Resolves the components of a submission to their assets and current
 * configurations (server side; never trusts the client's configuration).
 */
export async function resolveComponents(tx: Tx, tenantId: string, components: { slot: ComponentSlot; kind: ComponentKind; assetId: string; extraSpares?: number }[]): Promise<{ ok: true; components: ResolvedComponent[] } | { ok: false; slot: ComponentSlot; reason: "asset_not_found" | "kind_mismatch" }> {
  const out: ResolvedComponent[] = [];
  for (const c of components) {
    const [asset] = await tx<{ id: string; unit_number: string; type: ComponentKind; make: string | null; model: string | null; year: number | null }[]>`
      select id, unit_number, type, make, model, year from assets where id = ${c.assetId} and tenant_id = ${tenantId} and status = 'active'`;
    if (!asset) return { ok: false, slot: c.slot, reason: "asset_not_found" };
    if (asset.type !== c.kind) return { ok: false, slot: c.slot, reason: "kind_mismatch" };
    const cfg = await currentConfiguration(tx, asset.id);
    out.push({
      slot: c.slot,
      kind: asset.type,
      assetType: asset.type,
      assetId: asset.id,
      unitNumber: asset.unit_number,
      label: [asset.year, asset.make, asset.model].filter(Boolean).join(" ") || null,
      configurationId: cfg?.id ?? null,
      configVersion: cfg?.version ?? null,
      config: cfg?.config ?? defaultConfigFor(asset.type),
      extraSpares: c.extraSpares ?? 0,
    });
  }
  return { ok: true, components: out };
}

export interface DriverEquipment {
  asset: { id: string; unitNumber: string; type: ComponentKind; label: string | null };
  configurationId: string | null;
  configVersion: number | null;
  templateKey: string | null;
  config: EquipmentConfig;
  /** Mounted physical tires by position key without the inspection slot (`drive-1:LO`, `spare-1`). */
  mounted: Record<string, MountedTireInfo>;
}

/** Equipment details for the driver app: configuration + currently mounted tires (for pre-filling make/model/size). */
export async function driverEquipment(scope: Scope & { tenantId: string }, assetId: string): Promise<DriverEquipment | null> {
  return withScope(scope, async (tx) => {
    const [asset] = await tx<{ id: string; unit_number: string; type: ComponentKind; make: string | null; model: string | null; year: number | null }[]>`
      select id, unit_number, type, make, model, year from assets where id = ${assetId} and tenant_id = ${scope.tenantId} and status = 'active'`;
    if (!asset) return null;
    const cfg = await currentConfiguration(tx, asset.id);
    const tires = await tx<{ id: string; current_position_key: string; tire_variant_id: string | null; make: string | null; model: string | null; size: string | null; original_tread_32nds: number | null; max_cold_psi: number | null; brand_name: string | null; model_name: string | null; variant_size: string | null }[]>`
      select ta.id, ta.current_position_key, ta.tire_variant_id, ta.make, ta.model, ta.size, v.original_tread_32nds::float8 as original_tread_32nds, v.max_cold_psi,
             b.name as brand_name, m.name as model_name, v.size as variant_size
      from tire_assets ta
      left join tire_variants v on v.id = ta.tire_variant_id left join tire_models m on m.id = v.model_id left join tire_brands b on b.id = v.brand_id
      where ta.current_asset_id = ${asset.id} and ta.state in ('mounted', 'spare') and ta.current_position_key is not null`;
    const mounted: Record<string, MountedTireInfo> = {};
    for (const t of tires) {
      mounted[t.current_position_key] = {
        tireAssetId: t.id,
        tireVariantId: t.tire_variant_id,
        tireMake: t.brand_name ?? t.make,
        tireModel: t.model_name ?? t.model,
        tireSize: t.variant_size ?? t.size,
        originalTread32: t.original_tread_32nds,
        maxColdPsi: t.max_cold_psi,
      };
    }
    const config = cfg?.config ?? defaultConfigFor(asset.type);
    return {
      asset: { id: asset.id, unitNumber: asset.unit_number, type: asset.type, label: [asset.year, asset.make, asset.model].filter(Boolean).join(" ") || null },
      configurationId: cfg?.id ?? null,
      configVersion: cfg?.version ?? null,
      templateKey: cfg?.template_key ?? config.templateKey ?? templateByKey(config.templateKey ?? "")?.key ?? null,
      config,
      mounted,
    };
  });
}
