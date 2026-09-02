import "server-only";
import { withScope } from "@/lib/db/client";

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "inactive";
  settings: Record<string, unknown>;
}

/** Public lookup by slug (used by the inspection link). Only active tenants. */
export async function findActiveTenantBySlug(slug: string): Promise<TenantRow | null> {
  return withScope({ actor: "anon_lookup" }, async (tx) => {
    const rows = await tx<TenantRow[]>`select id, slug, name, status, settings from tenants where slug = ${slug} and status = 'active' limit 1`;
    return rows[0] ?? null;
  });
}
