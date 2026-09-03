import type { ComponentSlot } from "@/lib/equipment/layout";
import type { ComponentKind } from "@/lib/equipment/types";
import type { DraftAsset } from "@/lib/inspection/draft";

/**
 * Remembers the driver's most recently used equipment on this device so the
 * next inspection starts pre-selected. Convenience only: the selection is
 * always shown and can be changed.
 */
export interface RememberedComponent {
  slot: ComponentSlot;
  kind: ComponentKind;
  asset: DraftAsset;
}

const key = (tenantSlug: string, driverId: string) => `tc:last-equipment:${tenantSlug}:${driverId}`;

export function loadLastEquipment(tenantSlug: string, driverId: string): RememberedComponent[] | null {
  try {
    const raw = localStorage.getItem(key(tenantSlug, driverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { components?: RememberedComponent[] };
    return Array.isArray(parsed.components) && parsed.components.length ? parsed.components : null;
  } catch {
    return null;
  }
}

export function saveLastEquipment(tenantSlug: string, driverId: string, components: RememberedComponent[]): void {
  try {
    localStorage.setItem(key(tenantSlug, driverId), JSON.stringify({ components, savedAt: new Date().toISOString() }));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}
