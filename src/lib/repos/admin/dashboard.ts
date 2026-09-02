import "server-only";
import { withScope, type Scope } from "@/lib/db/client";

export interface DashboardData {
  periodDays: number;
  dueDays: number;
  /** ISO date (YYYY-MM-DD) where the period starts; used for KPI drill-down links. */
  since: string;
  kpis: {
    criticalTires: number;
    yellowTires: number;
    assetsDue: number;
    inspections: number;
    openTickets: number;
    driversActive: number;
    driversCompliant: number;
  };
  weekly: { week: string; inspections: number; avgPsi: number | null; avgTread: number | null }[];
  positions: { tire_number: number; avg_tread: number | null; avg_psi: number | null; red: number; yellow: number; n: number }[];
  spares: { asset_id: string; unit_number: string; type: "truck" | "trailer"; tire_number: number; tread_32nds: number | null; overall_status: string; absent: boolean; submitted_at: string }[];
  recent: { id: string; submitted_at: string; driver_name: string | null; truck_unit: string | null; trailer_unit: string | null; red: number; yellow: number; damaged: number }[];
}

export async function loadDashboard(scope: Scope & { tenantId: string }, opts: { periodDays?: number; dueDays?: number } = {}): Promise<DashboardData> {
  const periodDays = opts.periodDays ?? 30;
  const dueDays = opts.dueDays ?? 7;
  return withScope(scope, async (tx) => {
    const tid = scope.tenantId;
    const [tires] = await tx<{ red: number; yellow: number }[]>`
      select count(*) filter (where te.overall_status = 'red')::int as red, count(*) filter (where te.overall_status = 'yellow')::int as yellow
      from tire_entries te join inspections i on i.id = te.inspection_id
      where te.tenant_id = ${tid} and i.status = 'submitted' and i.submitted_at > now() - make_interval(days => ${periodDays})`;
    const [due] = await tx<{ n: number }[]>`
      select count(*)::int as n from assets a
      where a.tenant_id = ${tid} and a.status = 'active' and not exists (
        select 1 from inspections i where i.status = 'submitted' and (i.truck_asset_id = a.id or i.trailer_asset_id = a.id) and i.submitted_at > now() - make_interval(days => ${dueDays}))`;
    const [insp] = await tx<{ n: number }[]>`select count(*)::int as n from inspections where tenant_id = ${tid} and status = 'submitted' and submitted_at > now() - make_interval(days => ${periodDays})`;
    const [tickets] = await tx<{ n: number }[]>`select count(*)::int as n from service_tickets where tenant_id = ${tid} and status in ('open', 'in_progress')`;
    const [drivers] = await tx<{ active: number; compliant: number }[]>`
      select count(*)::int as active,
             count(*) filter (where exists (select 1 from inspections i where i.driver_id = d.id and i.status = 'submitted' and i.submitted_at > now() - make_interval(days => ${dueDays})))::int as compliant
      from drivers d where d.tenant_id = ${tid} and d.status = 'active'`;
    const weekly = await tx<{ week: string; inspections: number; avgPsi: number | null; avgTread: number | null }[]>`
      select to_char(date_trunc('week', i.submitted_at), 'YYYY-MM-DD') as week, count(distinct i.id)::int as inspections,
             round(avg(te.psi) filter (where te.absent = false), 1)::float8 as "avgPsi", round(avg(te.tread_32nds) filter (where te.absent = false), 1)::float8 as "avgTread"
      from inspections i join tire_entries te on te.inspection_id = i.id
      where i.tenant_id = ${tid} and i.status = 'submitted' and i.submitted_at > now() - interval '12 weeks'
      group by 1 order by 1`;
    const positions = await tx<DashboardData["positions"]>`
      select te.tire_number, round(avg(te.tread_32nds), 1)::float8 as avg_tread, round(avg(te.psi), 1)::float8 as avg_psi,
             count(*) filter (where te.overall_status = 'red')::int as red, count(*) filter (where te.overall_status = 'yellow')::int as yellow, count(*)::int as n
      from tire_entries te join inspections i on i.id = te.inspection_id
      where te.tenant_id = ${tid} and i.status = 'submitted' and te.absent = false and i.submitted_at > now() - make_interval(days => ${periodDays})
      group by te.tire_number order by te.tire_number`;
    const spares = await tx<DashboardData["spares"]>`
      select distinct on (te.asset_id, te.tire_number) te.asset_id, a.unit_number, a.type, te.tire_number, te.tread_32nds, te.overall_status, te.absent, i.submitted_at
      from tire_entries te join inspections i on i.id = te.inspection_id join assets a on a.id = te.asset_id
      where te.tenant_id = ${tid} and i.status = 'submitted' and te.tire_number in (19, 20) and a.status = 'active'
      order by te.asset_id, te.tire_number, i.submitted_at desc`;
    const recent = await tx<DashboardData["recent"]>`
      select i.id, i.submitted_at, d.full_name as driver_name, tr.unit_number as truck_unit, tl.unit_number as trailer_unit,
             coalesce((i.summary->>'red')::int, 0) as red, coalesce((i.summary->>'yellow')::int, 0) as yellow, coalesce((i.summary->>'damaged')::int, 0) as damaged
      from inspections i left join drivers d on d.id = i.driver_id left join assets tr on tr.id = i.truck_asset_id left join assets tl on tl.id = i.trailer_asset_id
      where i.tenant_id = ${tid} and i.status = 'submitted' order by i.submitted_at desc limit 8`;
    return {
      periodDays,
      dueDays,
      since: new Date(Date.now() - periodDays * 86_400_000).toISOString().slice(0, 10),
      kpis: { criticalTires: tires.red, yellowTires: tires.yellow, assetsDue: due.n, inspections: insp.n, openTickets: tickets.n, driversActive: drivers.active, driversCompliant: drivers.compliant },
      weekly,
      positions,
      spares: spares.sort((a, b) => a.unit_number.localeCompare(b.unit_number)),
      recent,
    };
  });
}
