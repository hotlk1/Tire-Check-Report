import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ReportView } from "@/components/report/ReportView";
import { getAdminSession } from "@/lib/auth/session";
import { getDriverSession } from "@/lib/driver/session";
import { loadReport, reportHistory } from "@/lib/repos/inspections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inspection report" };

/**
 * Hosted HTML report. Access: the driver session that owns the inspection, or
 * an admin/editor session whose current tenant owns it (RLS enforces both).
 */
export default async function ReportPage({ params, searchParams }: PageProps<"/report/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const driver = await getDriverSession();
  const admin = driver ? null : await getAdminSession();
  if (!driver && !admin) redirect("/admin/login");
  const scope = driver ? { actor: "driver" as const, tenantId: driver.tenantId, driverId: driver.driverId } : admin!.scope;
  const report = await loadReport(scope, id);
  if (!report) notFound();
  const history = await reportHistory(scope, [report.truck?.id, report.trailer?.id].filter((x): x is string => !!x), report.id);
  return <ReportView report={report} history={history} isNew={sp?.new === "1"} backHref={driver ? `/t/${driver.tenantSlug}/inspect` : `/admin/reports/${id}`} />;
}
