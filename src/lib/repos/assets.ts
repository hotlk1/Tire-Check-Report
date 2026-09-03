import "server-only";
import { withScope, type Scope } from "@/lib/db/client";

export interface AssetSummary {
  id: string;
  type: "truck" | "trailer" | "jeep" | "dolly" | "booster";
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  license_plate: string | null;
  last_odometer: number | null;
}

export async function searchAssets(scope: Scope, type: "truck" | "trailer" | "jeep" | "dolly" | "booster", query: string, limit = 20): Promise<AssetSummary[]> {
  const q = query.trim();
  return withScope(scope, async (tx) => {
    const rows = await tx<AssetSummary[]>`
      select id, type, unit_number, make, model, year, license_plate, last_odometer::float8 as last_odometer
      from assets
      where tenant_id = ${scope.tenantId!} and type = ${type} and status = 'active'
        and (${q} = '' or unit_number ilike ${"%" + q + "%"} or license_plate ilike ${"%" + q + "%"} or vin ilike ${"%" + q + "%"})
      order by (unit_number ilike ${q + "%"}) desc, unit_number
      limit ${limit}`;
    return rows;
  });
}
