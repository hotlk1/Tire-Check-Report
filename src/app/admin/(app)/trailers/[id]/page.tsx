import { AssetDetailPage } from "@/components/admin/assets/AssetDetailPage";

export default async function Page({ params, searchParams }: PageProps<"/admin/trailers/[id]">) {
  const { id } = await params;
  return <AssetDetailPage type="trailer" id={id} searchParams={await searchParams} />;
}
