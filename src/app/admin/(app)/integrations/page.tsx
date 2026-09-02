import { PageHeader, Panel } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";
import { withScope } from "@/lib/db/client";

export default async function IntegrationsPage() {
  const session = await requireAdmin();
  const { t } = await getServerTranslator();
  const rows = await withScope(session.scope, (tx) => tx<{ provider: string; kind: string; label: string; status: string }[]>`select provider, kind, label, status from integrations where tenant_id = ${session.scope.tenantId} order by kind, provider`);
  return (
    <>
      <PageHeader title={t("admin.integrations.title")} />
      <Panel>
        <p className="text-[13px] text-text-2">{t("admin.integrations.phase3")}</p>
        <p className="mt-2 text-[12px] text-text-3">{t("admin.common.total", { count: rows.length })}</p>
      </Panel>
    </>
  );
}
