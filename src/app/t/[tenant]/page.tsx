import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DriverEntry } from "@/components/driver/DriverEntry";
import { getServerTranslator } from "@/i18n/server";
import { getDriverSession } from "@/lib/driver/session";
import { findActiveTenantBySlug } from "@/lib/repos/tenants";
import { turnstileSiteKey } from "@/lib/security/turnstile";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/t/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const row = await findActiveTenantBySlug(tenant.toLowerCase()).catch(() => null);
  return { title: row ? `${row.name} · Tire Check` : "Tire Check" };
}

/** Tenant-specific driver entry: /t/{tenant} */
export default async function TenantEntryPage({ params }: PageProps<"/t/[tenant]">) {
  const { tenant } = await params;
  const slug = tenant.toLowerCase();
  const { t } = await getServerTranslator();
  const row = await findActiveTenantBySlug(slug);
  if (!row) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="text-4xl">🚫</div>
        <p className="mt-3 text-[15px] text-text-2">{t("driver.tenantNotFound")}</p>
      </main>
    );
  }
  const session = await getDriverSession();
  if (session && session.tenantSlug === row.slug) redirect(`/t/${row.slug}/inspect`);
  return (
    <main className="flex flex-1 flex-col">
      <DriverEntry tenantSlug={row.slug} tenantName={row.name} turnstileSiteKey={turnstileSiteKey()} />
    </main>
  );
}
