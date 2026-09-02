import { AssetListPage } from "@/components/admin/assets/AssetListPage";

export default async function Page({ searchParams }: PageProps<"/admin/trucks">) {
  return <AssetListPage type="truck" searchParams={await searchParams} />;
}
