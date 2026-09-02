import "server-only";
import { withScope, type Scope } from "@/lib/db/client";
import { audit, diffObjects } from "@/lib/audit";
import { normalizeUsPhone } from "@/lib/driver/phone";

export interface DriverListRow {
  id: string;
  full_name: string;
  phone: string;
  status: "active" | "inactive";
  locale: string | null;
  external_ref: string | null;
  last_inspection_at: string | null;
  inspections_30d: number;
  created_at: string;
}

export interface DriverInput {
  full_name: string;
  phone: string;
  status: "active" | "inactive";
  locale?: string | null;
  external_ref?: string | null;
}

export async function listDrivers(scope: Scope & { tenantId: string }, opts: { q?: string; status?: "active" | "inactive" | "all" } = {}): Promise<DriverListRow[]> {
  const q = (opts.q ?? "").trim();
  const status = opts.status ?? "all";
  return withScope(scope, async (tx) =>
    tx<DriverListRow[]>`
      select d.id, d.full_name, d.phone, d.status, d.locale, d.external_ref, d.created_at,
             (select max(i.submitted_at) from inspections i where i.driver_id = d.id and i.status = 'submitted') as last_inspection_at,
             (select count(*)::int from inspections i where i.driver_id = d.id and i.status = 'submitted' and i.submitted_at > now() - interval '30 days') as inspections_30d
      from drivers d
      where d.tenant_id = ${scope.tenantId}
        and (${status} = 'all' or d.status::text = ${status})
        and (${q} = '' or d.full_name ilike ${"%" + q + "%"} or d.phone like ${"%" + q.replace(/\D/g, "") + "%"})
      order by d.status, d.full_name`,
  );
}

export async function getDriver(scope: Scope & { tenantId: string }, id: string) {
  return withScope(scope, async (tx) => {
    const rows = await tx<DriverListRow[]>`select id, full_name, phone, status, locale, external_ref, created_at, null::timestamptz as last_inspection_at, 0 as inspections_30d from drivers where id = ${id} and tenant_id = ${scope.tenantId}`;
    return rows[0] ?? null;
  });
}

export class DriverError extends Error {
  constructor(public readonly code: "phone_invalid" | "duplicate_phone" | "not_found") {
    super(code);
  }
}

export async function createDriver(scope: Scope & { tenantId: string; userId: string }, input: DriverInput, actorLabel: string) {
  const phone = normalizeUsPhone(input.phone);
  if (!phone) throw new DriverError("phone_invalid");
  return withScope(scope, async (tx) => {
    const dup = await tx`select 1 from drivers where tenant_id = ${scope.tenantId} and phone = ${phone}`;
    if (dup.length) throw new DriverError("duplicate_phone");
    const [row] = await tx<{ id: string }[]>`insert into drivers (tenant_id, full_name, phone, status, locale, external_ref)
      values (${scope.tenantId}, ${input.full_name.trim()}, ${phone}, ${input.status}, ${input.locale ?? null}, ${input.external_ref ?? null}) returning id`;
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "create", entityType: "driver", entityId: row.id, newValue: { ...input, phone } });
    return row.id;
  });
}

export async function updateDriver(scope: Scope & { tenantId: string; userId: string }, id: string, input: Partial<DriverInput>, actorLabel: string) {
  const phone = input.phone !== undefined ? normalizeUsPhone(input.phone) : undefined;
  if (input.phone !== undefined && !phone) throw new DriverError("phone_invalid");
  return withScope(scope, async (tx) => {
    const [before] = await tx<Record<string, unknown>[]>`select full_name, phone, status, locale, external_ref from drivers where id = ${id} and tenant_id = ${scope.tenantId}`;
    if (!before) throw new DriverError("not_found");
    if (phone) {
      const dup = await tx`select 1 from drivers where tenant_id = ${scope.tenantId} and phone = ${phone} and id <> ${id}`;
      if (dup.length) throw new DriverError("duplicate_phone");
    }
    const after = {
      full_name: input.full_name?.trim() ?? (before.full_name as string),
      phone: phone ?? (before.phone as string),
      status: input.status ?? (before.status as "active" | "inactive"),
      locale: input.locale === undefined ? (before.locale as string | null) : input.locale,
      external_ref: input.external_ref === undefined ? (before.external_ref as string | null) : input.external_ref,
    };
    await tx`update drivers set full_name = ${after.full_name}, phone = ${after.phone}, status = ${after.status}, locale = ${after.locale}, external_ref = ${after.external_ref} where id = ${id} and tenant_id = ${scope.tenantId}`;
    const d = diffObjects(before, after as Record<string, unknown>);
    if (Object.keys(d.new).length) {
      await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "update", entityType: "driver", entityId: id, oldValue: d.old, newValue: d.new });
    }
  });
}

export interface ImportRow {
  name: string;
  phone: string;
  status?: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

/** CSV import: upsert by (tenant, phone). Rows with invalid phones are reported, not imported. */
export async function importDrivers(scope: Scope & { tenantId: string; userId: string }, rows: ImportRow[], actorLabel: string): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  return withScope(scope, async (tx) => {
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const phone = normalizeUsPhone(r.phone ?? "");
      const name = (r.name ?? "").trim();
      if (!phone || !name) {
        result.skipped += 1;
        result.errors.push({ row: i + 2, reason: !name ? "name_missing" : "phone_invalid" });
        continue;
      }
      if (seen.has(phone)) {
        result.skipped += 1;
        result.errors.push({ row: i + 2, reason: "duplicate_in_file" });
        continue;
      }
      seen.add(phone);
      const status = (r.status ?? "active").trim().toLowerCase() === "inactive" ? "inactive" : "active";
      const [row] = await tx<{ inserted: boolean }[]>`
        insert into drivers (tenant_id, full_name, phone, status) values (${scope.tenantId}, ${name}, ${phone}, ${status})
        on conflict (tenant_id, phone) do update set full_name = excluded.full_name, status = excluded.status
        returning (xmax = 0) as inserted`;
      if (row.inserted) result.created += 1;
      else result.updated += 1;
    }
    await audit(tx, { tenantId: scope.tenantId, actorUserId: scope.userId, actorLabel, action: "import", entityType: "driver", newValue: { rows: rows.length, ...result, errors: result.errors.slice(0, 50) } });
    return result;
  });
}
