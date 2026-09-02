import { PageHeader, Panel } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { withScope } from "@/lib/db/client";

export default async function TicketsPage() {
  const session = await requireAdmin();
  const { t } = await getServerTranslator();
  const [{ n }] = await withScope(session.scope, (tx) => tx<{ n: number }[]>`select count(*)::int as n from service_tickets where tenant_id = ${session.scope.tenantId}`);
  return (
    <>
      <PageHeader title={t("admin.tickets.title")} />
      <Panel>
        <p className="text-[13px] text-text-2">{t("admin.tickets.phase3")}</p>
        <p className="mt-2 text-[12px] text-text-3">{t("admin.common.total", { count: n })}</p>
      </Panel>
    </>
  );
}
