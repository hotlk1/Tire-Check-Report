import { AssetListPage } from "@/components/admin/assets/AssetListPage";
import type { ComponentKind } from "@/lib/equipment/types";

/** Jeeps, dollies and boosters (heavy-haul components). */
export default async function Page({ searchParams }: PageProps<"/admin/equipment">) {
  const sp = await searchParams;
  const kind = (["jeep", "dolly", "booster"].includes(String(sp.kind)) ? String(sp.kind) : "jeep") as ComponentKind;
  return <AssetListPage type={kind} searchParams={sp} />;
}
