import { AssetDetailPage } from "@/components/admin/assets/AssetDetailPage";

export default async function Page({ params, searchParams }: PageProps<"/admin/trucks/[id]">) {
  const { id } = await params;
  return <AssetDetailPage type="truck" id={id} searchParams={await searchParams} />;
}
