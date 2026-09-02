import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const tenants = session.user.isSuperAdmin ? undefined : session.memberships.map((m) => ({ slug: m.tenantSlug, name: m.tenantName }));
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <AdminNav
        user={{ email: session.user.email, name: session.user.name, role: session.role }}
        tenant={session.tenant ? { slug: session.tenant.slug, name: session.tenant.name } : null}
        tenants={tenants}
        authProvider={session.authProvider}
      />
      <main className="min-w-0 flex-1 px-4 py-4 md:px-6 md:py-5">{children}</main>
    </div>
  );
}
