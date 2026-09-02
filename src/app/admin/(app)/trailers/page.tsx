import { AssetListPage } from "@/components/admin/assets/AssetListPage";

export default async function Page({ searchParams }: PageProps<"/admin/trailers">) {
  return <AssetListPage type="trailer" searchParams={await searchParams} />;
}
