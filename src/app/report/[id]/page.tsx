import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ReportView } from "@/components/report/ReportView";
import { getDriverSession } from "@/lib/driver/session";
import { loadReport, reportHistory } from "@/lib/repos/inspections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inspection report" };

/**
 * Hosted HTML report. Phase 1 access: the driver session that owns the
 * inspection (same tenant). Phase 2 adds admin/editor access via memberships.
 */
export default async function ReportPage({ params, searchParams }: PageProps<"/report/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const session = await getDriverSession();
  if (!session) redirect("/");
  const scope = { actor: "driver" as const, tenantId: session.tenantId, driverId: session.driverId };
  const report = await loadReport(scope, id);
  if (!report) notFound();
  const history = await reportHistory(scope, [report.truck?.id, report.trailer?.id].filter((x): x is string => !!x), report.id);
  return <ReportView report={report} history={history} isNew={sp?.new === "1"} backHref={`/t/${session.tenantSlug}/inspect`} />;
}
