import { redirect } from "next/navigation";
import { InspectionScreen } from "@/components/inspection/InspectionScreen";
import { getDriverSession } from "@/lib/driver/session";

export const dynamic = "force-dynamic";

export default async function InspectPage({ params }: PageProps<"/t/[tenant]/inspect">) {
  const { tenant } = await params;
  const slug = tenant.toLowerCase();
  const session = await getDriverSession();
  if (!session || session.tenantSlug !== slug) redirect(`/t/${slug}`);
  return (
    <InspectionScreen
      ctx={{ tenantSlug: session.tenantSlug, tenantName: session.tenantName, driverId: session.driverId, driverName: session.driverName }}
    />
  );
}
