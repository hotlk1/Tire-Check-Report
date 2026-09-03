import type { ComponentKind } from "./types";

/** Admin route base for an asset kind. Jeeps, dollies and boosters live under /admin/equipment. */
export function assetBase(kind: string): string {
  if (kind === "truck") return "/admin/trucks";
  if (kind === "trailer") return "/admin/trailers";
  return "/admin/equipment";
}

export const EXTRA_KINDS: ComponentKind[] = ["jeep", "dolly", "booster"];
