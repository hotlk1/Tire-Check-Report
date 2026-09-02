import "server-only";
import type postgres from "postgres";
import { withScope, type Scope, type Tx } from "@/lib/db/client";
import { audit, diffObjects } from "@/lib/audit";
import type { CatalogStatus, CatalogSyncBatch, TireApplication } from "./provider";

export interface BrandRow {
  id: string;
  tenant_id: string | null;
  name: string;
  slug: string;
  country: string | null;
  website: string | null;
  status: CatalogStatus;
  provider: string;
  models_count?: number;
}

export interface ModelRow {
  id: string;
  tenant_id: string | null;
  brand_id: string;
  brand_name?: string;
  name: string;
  application: TireApplication;
  category: string | null;
  status: CatalogStatus;
  provider: string;
  variants_count?: number;
}

export interface VariantRow {
  id: string;
  tenant_id: string | null;
  brand_id: string;
  model_id: string;
  brand_name?: string;
  model_name?: string;
  size: string;
  part_number: string | null;
  application: TireApplication;
  load_range: string | null;
  ply_rating: number | null;
  load_index_single: number | null;
  load_index_dual: number | null;
  speed_rating: string | null;
  max_cold_psi: number | null;
  original_tread_32nds: number | null;
  rim_size: string | null;
  status: CatalogStatus;
  provider: string;
  provider_external_id: string | null;
  last_synced_at: string | null;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Read (drivers + admins). Shared rows + the current tenant's custom rows.
// ---------------------------------------------------------------------------
export async function listBrands(scope: Scope, opts: { q?: string; includeDiscontinued?: boolean } = {}): Promise<BrandRow[]> {
  const q = (opts.q ?? "").trim();
  return withScope(scope, (tx) =>
    tx<BrandRow[]>`
      select b.id, b.tenant_id, b.name, b.slug, b.country, b.website, b.status, b.provider,
             (select count(*)::int from tire_models m where m.brand_id = b.id and m.status = 'active') as models_count
      from tire_brands b
      where (${!!opts.includeDiscontinued} or b.status = 'active')
        and (${q} = '' or b.name ilike ${"%" + q + "%"})
      order by (b.tenant_id is not null) desc, b.name`,
  );
}

export async function listModels(scope: Scope, opts: { brandId?: string | null; q?: string; includeDiscontinued?: boolean } = {}): Promise<ModelRow[]> {
  const q = (opts.q ?? "").trim();
  return withScope(scope, (tx) =>
    tx<ModelRow[]>`
      select m.id, m.tenant_id, m.brand_id, b.name as brand_name, m.name, m.application, m.category, m.status, m.provider,
             (select count(*)::int from tire_variants v where v.model_id = m.id and v.status = 'active') as variants_count
      from tire_models m join tire_brands b on b.id = m.brand_id
      where (${opts.brandId ?? null}::uuid is null or m.brand_id = ${opts.brandId ?? null})
        and (${!!opts.includeDiscontinued} or m.status = 'active')
        and (${q} = '' or m.name ilike ${"%" + q + "%"} or b.name ilike ${"%" + q + "%"})
      order by b.name, m.name`,
  );
}

export async function listVariants(
  scope: Scope,
  opts: { modelId?: string | null; brandId?: string | null; q?: string; size?: string | null; includeDiscontinued?: boolean; limit?: number } = {},
): Promise<VariantRow[]> {
  const q = (opts.q ?? "").trim();
  return withScope(scope, (tx) =>
    tx<VariantRow[]>`
      select v.id, v.tenant_id, v.brand_id, v.model_id, b.name as brand_name, m.name as model_name, v.size, v.part_number, v.application,
             v.load_range, v.ply_rating, v.load_index_single, v.load_index_dual, v.speed_rating, v.max_cold_psi, v.original_tread_32nds::float8 as original_tread_32nds,
             v.rim_size, v.status, v.provider, v.provider_external_id, v.last_synced_at
      from tire_variants v join tire_models m on m.id = v.model_id join tire_brands b on b.id = v.brand_id
      where (${opts.modelId ?? null}::uuid is null or v.model_id = ${opts.modelId ?? null})
        and (${opts.brandId ?? null}::uuid is null or v.brand_id = ${opts.brandId ?? null})
        and (${opts.size ?? null}::text is null or v.size = ${opts.size ?? null})
        and (${!!opts.includeDiscontinued} or v.status = 'active')
        and (${q} = '' or v.size ilike ${"%" + q + "%"} or v.part_number ilike ${"%" + q + "%"} or m.name ilike ${"%" + q + "%"} or b.name ilike ${"%" + q + "%"})
      order by b.name, m.name, v.size, v.load_range
      limit ${Math.min(500, opts.limit ?? 200)}`,
  );
}

/** Distinct sizes across the catalog (for the size-first path of the picker). */
export async function listSizes(scope: Scope, q = ""): Promise<{ size: string; n: number }[]> {
  return withScope(scope, (tx) =>
    tx<{ size: string; n: number }[]>`
      select size, count(*)::int as n from tire_variants where status = 'active' and (${q.trim()} = '' or size ilike ${"%" + q.trim() + "%"})
      group by size order by n desc, size limit 50`,
  );
}

export async function getVariant(scope: Scope, id: string): Promise<VariantRow | null> {
  const rows = await listVariants(scope, { includeDiscontinued: true, limit: 1, q: "" }).then(() => null);
  void rows;
  return withScope(scope, async (tx) => {
    const r = await tx<VariantRow[]>`
      select v.id, v.tenant_id, v.brand_id, v.model_id, b.name as brand_name, m.name as model_name, v.size, v.part_number, v.application,
             v.load_range, v.ply_rating, v.load_index_single, v.load_index_dual, v.speed_rating, v.max_cold_psi, v.original_tread_32nds::float8 as original_tread_32nds,
             v.rim_size, v.status, v.provider, v.provider_external_id, v.last_synced_at
      from tire_variants v join tire_models m on m.id = v.model_id join tire_brands b on b.id = v.brand_id where v.id = ${id}`;
    return r[0] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Admin writes. `tenantId` null = shared catalog (super admins only, enforced by RLS).
// ---------------------------------------------------------------------------
export interface BrandInput {
  name: string;
  country?: string | null;
  website?: string | null;
  status?: CatalogStatus;
}
export interface ModelInput {
  brand_id: string;
  name: string;
  application: TireApplication;
  category?: string | null;
  status?: CatalogStatus;
}
export interface VariantInput {
  model_id: string;
  size: string;
  part_number?: string | null;
  application: TireApplication;
  load_range?: string | null;
  ply_rating?: number | null;
  load_index_single?: number | null;
  load_index_dual?: number | null;
  speed_rating?: string | null;
  max_cold_psi?: number | null;
  original_tread_32nds?: number | null;
  rim_size?: string | null;
  status?: CatalogStatus;
}

type Actor = Scope & { userId: string };

export async function saveBrand(scope: Actor, tenantId: string | null, id: string | null, input: BrandInput, actorLabel: string): Promise<string> {
  return withScope(scope, async (tx) => {
    if (id) {
      const [before] = await tx<Record<string, unknown>[]>`select name, country, website, status from tire_brands where id = ${id}`;
      if (!before) throw new Error("not_found");
      await tx`update tire_brands set name = ${input.name.trim()}, slug = ${slugify(input.name)}, country = ${input.country || null}, website = ${input.website || null}, status = ${input.status ?? "active"} where id = ${id}`;
      const d = diffObjects(before, { name: input.name.trim(), country: input.country || null, website: input.website || null, status: input.status ?? "active" });
      if (Object.keys(d.new).length) await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_brand", entityId: id, oldValue: d.old, newValue: d.new });
      return id;
    }
    const [row] = await tx<{ id: string }[]>`insert into tire_brands (tenant_id, name, slug, country, website, status, created_by)
      values (${tenantId}, ${input.name.trim()}, ${slugify(input.name)}, ${input.country || null}, ${input.website || null}, ${input.status ?? "active"}, ${scope.userId}) returning id`;
    await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "tire_brand", entityId: row.id, newValue: input });
    return row.id;
  });
}

export async function saveModel(scope: Actor, tenantId: string | null, id: string | null, input: ModelInput, actorLabel: string): Promise<string> {
  return withScope(scope, async (tx) => {
    if (id) {
      const [before] = await tx<Record<string, unknown>[]>`select brand_id, name, application, category, status from tire_models where id = ${id}`;
      if (!before) throw new Error("not_found");
      const after = { brand_id: input.brand_id, name: input.name.trim(), application: input.application, category: input.category || null, status: input.status ?? "active" };
      await tx`update tire_models set brand_id = ${after.brand_id}, name = ${after.name}, application = ${after.application}, category = ${after.category}, status = ${after.status} where id = ${id}`;
      const d = diffObjects(before, after as Record<string, unknown>);
      if (Object.keys(d.new).length) await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_model", entityId: id, oldValue: d.old, newValue: d.new });
      return id;
    }
    const [row] = await tx<{ id: string }[]>`insert into tire_models (tenant_id, brand_id, name, application, category, status, created_by)
      values (${tenantId}, ${input.brand_id}, ${input.name.trim()}, ${input.application}, ${input.category || null}, ${input.status ?? "active"}, ${scope.userId}) returning id`;
    await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "tire_model", entityId: row.id, newValue: input });
    return row.id;
  });
}

export async function saveVariant(scope: Actor, tenantId: string | null, id: string | null, input: VariantInput, actorLabel: string): Promise<string> {
  return withScope(scope, async (tx) => {
    const [model] = await tx<{ brand_id: string }[]>`select brand_id from tire_models where id = ${input.model_id}`;
    if (!model) throw new Error("model_not_found");
    const after = {
      model_id: input.model_id,
      brand_id: model.brand_id,
      size: input.size.trim().toUpperCase(),
      part_number: input.part_number?.trim() || null,
      application: input.application,
      load_range: input.load_range?.trim().toUpperCase() || null,
      ply_rating: input.ply_rating ?? null,
      load_index_single: input.load_index_single ?? null,
      load_index_dual: input.load_index_dual ?? null,
      speed_rating: input.speed_rating?.trim().toUpperCase() || null,
      max_cold_psi: input.max_cold_psi ?? null,
      original_tread_32nds: input.original_tread_32nds ?? null,
      rim_size: input.rim_size?.trim() || null,
      status: input.status ?? "active",
    };
    if (id) {
      const [before] = await tx<Record<string, unknown>[]>`select model_id, brand_id, size, part_number, application, load_range, ply_rating, load_index_single, load_index_dual, speed_rating, max_cold_psi, original_tread_32nds::float8 as original_tread_32nds, rim_size, status from tire_variants where id = ${id}`;
      if (!before) throw new Error("not_found");
      await tx`update tire_variants set model_id = ${after.model_id}, brand_id = ${after.brand_id}, size = ${after.size}, part_number = ${after.part_number}, application = ${after.application},
        load_range = ${after.load_range}, ply_rating = ${after.ply_rating}, load_index_single = ${after.load_index_single}, load_index_dual = ${after.load_index_dual},
        speed_rating = ${after.speed_rating}, max_cold_psi = ${after.max_cold_psi}, original_tread_32nds = ${after.original_tread_32nds}, rim_size = ${after.rim_size}, status = ${after.status}
        where id = ${id}`;
      const d = diffObjects(before, after as Record<string, unknown>);
      if (Object.keys(d.new).length) await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "tire_variant", entityId: id, oldValue: d.old, newValue: d.new });
      return id;
    }
    const [row] = await tx<{ id: string }[]>`insert into tire_variants (tenant_id, brand_id, model_id, size, part_number, application, load_range, ply_rating, load_index_single, load_index_dual,
        speed_rating, max_cold_psi, original_tread_32nds, rim_size, status, created_by)
      values (${tenantId}, ${after.brand_id}, ${after.model_id}, ${after.size}, ${after.part_number}, ${after.application}, ${after.load_range}, ${after.ply_rating}, ${after.load_index_single}, ${after.load_index_dual},
        ${after.speed_rating}, ${after.max_cold_psi}, ${after.original_tread_32nds}, ${after.rim_size}, ${after.status}, ${scope.userId}) returning id`;
    await audit(tx, { tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "tire_variant", entityId: row.id, newValue: after });
    return row.id;
  });
}

// ---------------------------------------------------------------------------
// Sync from an external provider: upsert keyed by (provider, external id).
// Used by future adapters; the manual provider never calls it.
// ---------------------------------------------------------------------------
export async function upsertCatalogBatch(tx: Tx, provider: string, batch: CatalogSyncBatch): Promise<{ brands: number; models: number; variants: number }> {
  const now = new Date();
  let brands = 0;
  for (const b of batch.brands) {
    await tx`insert into tire_brands (tenant_id, name, slug, country, website, status, provider, provider_external_id, last_synced_at)
      values (null, ${b.name}, ${slugify(b.name)}, ${b.country ?? null}, ${b.website ?? null}, ${b.status ?? "active"}, ${provider}, ${b.externalId}, ${now})
      on conflict (provider, provider_external_id) where provider_external_id is not null
      do update set name = excluded.name, country = excluded.country, website = excluded.website, status = excluded.status, last_synced_at = excluded.last_synced_at`;
    brands += 1;
  }
  let models = 0;
  for (const m of batch.models) {
    await tx`insert into tire_models (tenant_id, brand_id, name, application, category, status, provider, provider_external_id, last_synced_at)
      select null, b.id, ${m.name}, ${m.application}, ${m.category ?? null}, ${m.status ?? "active"}, ${provider}, ${m.externalId}, ${now}
      from tire_brands b where b.provider = ${provider} and b.provider_external_id = ${m.brandExternalId}
      on conflict (provider, provider_external_id) where provider_external_id is not null
      do update set name = excluded.name, application = excluded.application, category = excluded.category, status = excluded.status, last_synced_at = excluded.last_synced_at`;
    models += 1;
  }
  let variants = 0;
  for (const v of batch.variants) {
    await tx`insert into tire_variants (tenant_id, brand_id, model_id, size, part_number, application, load_range, ply_rating, load_index_single, load_index_dual, speed_rating,
        max_cold_psi, original_tread_32nds, rim_size, status, provider, provider_external_id, last_synced_at, attributes)
      select null, m.brand_id, m.id, ${v.size}, ${v.partNumber ?? null}, ${v.application}, ${v.loadRange ?? null}, ${v.plyRating ?? null}, ${v.loadIndexSingle ?? null}, ${v.loadIndexDual ?? null}, ${v.speedRating ?? null},
        ${v.maxColdPsi ?? null}, ${v.originalTread32nds ?? null}, ${v.rimSize ?? null}, ${v.status ?? "active"}, ${provider}, ${v.externalId}, ${now}, ${tx.json((v.attributes ?? {}) as postgres.JSONValue)}
      from tire_models m where m.provider = ${provider} and m.provider_external_id = ${v.modelExternalId}
      on conflict (provider, provider_external_id) where provider_external_id is not null
      do update set size = excluded.size, part_number = excluded.part_number, application = excluded.application, load_range = excluded.load_range, ply_rating = excluded.ply_rating,
        load_index_single = excluded.load_index_single, load_index_dual = excluded.load_index_dual, speed_rating = excluded.speed_rating, max_cold_psi = excluded.max_cold_psi,
        original_tread_32nds = excluded.original_tread_32nds, rim_size = excluded.rim_size, status = excluded.status, last_synced_at = excluded.last_synced_at, attributes = excluded.attributes`;
    variants += 1;
  }
  return { brands, models, variants };
}
