import { headers } from "next/headers";
import QRCode from "qrcode";
import { PageHeader, Panel } from "@/components/admin/ui";
import { CopyButton } from "@/components/admin/CopyButton";
import { getServerTranslator } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth/session";

export default async function TireCheckPage() {
  const session = await requireAdmin();
  const { t } = await getServerTranslator();
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const url = `${proto}://${host}/t/${session.tenant?.slug ?? ""}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
  return (
    <>
      <PageHeader title={t("admin.tireCheck.title")} subtitle={t("admin.tireCheck.body")} />
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title={t("admin.tireCheck.link")}>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-surface-3 px-2 py-1 text-[13px]">{url}</code>
            <CopyButton text={url} label={t("admin.tireCheck.copy")} />
            <a className="text-[13px] font-semibold text-accent" href={url} target="_blank" rel="noreferrer">
              {t("admin.tireCheck.open")} ↗
            </a>
          </div>
        </Panel>
        <Panel title={t("admin.tireCheck.qr")}>
          <div className="w-60 max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        </Panel>
      </div>
    </>
  );
}
