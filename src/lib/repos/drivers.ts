import "server-only";
import { withScope } from "@/lib/db/client";

export interface DriverRow {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string;
  status: "active" | "inactive";
  locale: string | null;
}

/**
 * Exact-match lookup: tenant + 10-digit phone + active. There is deliberately
 * no list/search variant reachable from public endpoints (spec §2).
 */
export async function findActiveDriverByPhone(tenantId: string, phone: string): Promise<DriverRow | null> {
  return withScope({ actor: "anon_lookup", tenantId }, async (tx) => {
    const rows = await tx<DriverRow[]>`
      select id, tenant_id, full_name, phone, status, locale
      from drivers
      where tenant_id = ${tenantId} and phone = ${phone} and status = 'active'
      limit 1`;
    return rows[0] ?? null;
  });
}
