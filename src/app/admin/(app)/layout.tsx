import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/auth/session";
import { withScope } from "@/lib/db/client";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const tenants = session.user.isSuperAdmin ? undefined : session.memberships.map((m) => ({ slug: m.tenantSlug, name: m.tenantName }));
  const tid = session.scope.tenantId;
  const [c] = await withScope(session.scope, (tx) =>
    tx<{ reports: number; trucks: number; trailers: number; drivers: number; tickets: number }[]>`
      select (select count(*)::int from inspections where tenant_id = ${tid} and status = 'submitted' and submitted_at > now() - interval '30 days') as reports,
             (select count(*)::int from assets where tenant_id = ${tid} and type = 'truck' and status = 'active') as trucks,
             (select count(*)::int from assets where tenant_id = ${tid} and type = 'trailer' and status = 'active') as trailers,
             (select count(*)::int from drivers where tenant_id = ${tid} and status = 'active') as drivers,
             (select count(*)::int from service_tickets where tenant_id = ${tid} and status in ('open','in_progress')) as tickets`,
  );
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row" style={{ background: "var(--bg)" }}>
      <AdminNav
        user={{ email: session.user.email, name: session.user.name, role: session.role }}
        tenant={session.tenant ? { slug: session.tenant.slug, name: session.tenant.name } : null}
        tenants={tenants}
        authProvider={session.authProvider}
        counts={c}
      />
      <main className="min-w-0 flex-1" style={{ padding: "20px 26px 28px" }}>{children}</main>
    </div>
  );
}
