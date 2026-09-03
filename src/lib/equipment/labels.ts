import type { MessageKey, Translator } from "@/i18n";
import { axleByKey, type InspectionLayout, type LayoutAxle, type LayoutComponent } from "./layout";

/** "Tractor" / "Trailer" / "Jeep" / … for a component slot (shared by client and server rendering). */
export function componentName(t: Translator, c: Pick<LayoutComponent, "slot" | "kind">): string {
  if (c.slot === "trailer2") return `${t("equipment.trailer")} 2`;
  if (c.kind === "truck") return t("design.tractor");
  return t(`equipment.kinds.${c.kind}` as MessageKey);
}

/** "Drive axle 2" / "Steer axle" / custom label. */
export function axleLabel(t: Translator, component: LayoutComponent, axle: LayoutAxle): string {
  if (axle.label) return axle.label;
  const sameRole = component.axles.filter((a) => a.role === axle.role).length;
  const base = t(axle.roleLabelKey as MessageKey);
  return sameRole > 1 ? `${base} ${axle.roleIndex}` : base;
}

/** "Drive axle 2 · Tractor 4182" for a position of a layout. */
export function positionLabel(t: Translator, layout: InspectionLayout, number: number): string {
  const pos = layout.positions.find((p) => p.number === number);
  if (!pos) return `#${number}`;
  const component = layout.components.find((c) => c.slot === pos.slot)!;
  const where = `${componentName(t, component)} ${component.unitNumber ?? ""}`.trim();
  if (pos.isSpare) return `${t("design.sheet.spare")} · ${where}`;
  const axle = axleByKey(layout, pos.axleKey);
  return axle ? `${axleLabel(t, component, axle)} · ${where}` : where;
}
