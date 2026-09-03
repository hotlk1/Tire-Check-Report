import { AssetDetailPage } from "@/components/admin/assets/AssetDetailPage";

export default async function Page({ params, searchParams }: PageProps<"/admin/equipment/[id]">) {
  const { id } = await params;
  return <AssetDetailPage type="extra" id={id} searchParams={await searchParams} />;
}
