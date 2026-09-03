import type { AxleDefinitionConfig, ComponentKind, EquipmentConfig } from "./types";

/**
 * Built-in configuration templates. The two "standard" ones reproduce the
 * original fixed 20-position layout (steer + 2 drive axles + spare; 2 trailer
 * axles + spare) so existing fleets need no setup. Tenants can publish
 * per-asset configurations derived from any template.
 */
export interface EquipmentTemplate {
  key: string;
  kind: ComponentKind;
  /** i18n key under equipment.templates.* */
  labelKey: string;
  config: EquipmentConfig;
}

const axle = (key: string, role: AxleDefinitionConfig["role"], wheels: AxleDefinitionConfig["wheels"] = "dual", extra: Partial<AxleDefinitionConfig> = {}): AxleDefinitionConfig => ({ key, role, wheels, ...extra });
const spares = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `spare-${i + 1}` }));
const trailerAxles = (n: number, wheels: AxleDefinitionConfig["wheels"] = "dual") => Array.from({ length: n }, (_, i) => axle(`axle-${i + 1}`, "trailer", wheels));

export const TEMPLATES: EquipmentTemplate[] = [
  { key: "tractor-standard", kind: "truck", labelKey: "equipment.templates.tractorStandard", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-standard", axles: [axle("steer", "steer", "single"), axle("drive-1", "drive"), axle("drive-2", "drive")], spares: spares(1) } },
  { key: "tractor-single-drive", kind: "truck", labelKey: "equipment.templates.tractorSingleDrive", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-single-drive", axles: [axle("steer", "steer", "single"), axle("drive-1", "drive")], spares: spares(1) } },
  { key: "tractor-pusher", kind: "truck", labelKey: "equipment.templates.tractorPusher", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-pusher", axles: [axle("steer", "steer", "single"), axle("pusher-1", "pusher", "dual", { liftable: true }), axle("drive-1", "drive"), axle("drive-2", "drive")], spares: spares(1) } },
  { key: "tractor-tag", kind: "truck", labelKey: "equipment.templates.tractorTag", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-tag", axles: [axle("steer", "steer", "single"), axle("drive-1", "drive"), axle("drive-2", "drive"), axle("tag-1", "tag", "dual", { liftable: true })], spares: spares(1) } },
  { key: "tractor-twin-steer", kind: "truck", labelKey: "equipment.templates.tractorTwinSteer", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-twin-steer", axles: [axle("steer", "steer", "single"), axle("steer-2", "steer", "single"), axle("drive-1", "drive"), axle("drive-2", "drive")], spares: spares(1) } },
  { key: "tractor-super-single", kind: "truck", labelKey: "equipment.templates.tractorSuperSingle", config: { schemaVersion: 1, kind: "truck", templateKey: "tractor-super-single", axles: [axle("steer", "steer", "single"), axle("drive-1", "drive", "super_single"), axle("drive-2", "drive", "super_single")], spares: spares(1) } },
  { key: "trailer-2-axle", kind: "trailer", labelKey: "equipment.templates.trailer2", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-2-axle", axles: trailerAxles(2), spares: spares(2) } },
  { key: "trailer-3-axle", kind: "trailer", labelKey: "equipment.templates.trailer3", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-3-axle", axles: trailerAxles(3), spares: spares(2) } },
  { key: "trailer-4-axle", kind: "trailer", labelKey: "equipment.templates.trailer4", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-4-axle", axles: trailerAxles(4), spares: spares(2) } },
  { key: "trailer-5-axle", kind: "trailer", labelKey: "equipment.templates.trailer5", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-5-axle", axles: trailerAxles(5), spares: spares(2) } },
  { key: "trailer-2-axle-super-single", kind: "trailer", labelKey: "equipment.templates.trailer2SuperSingle", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-2-axle-super-single", axles: trailerAxles(2, "super_single"), spares: spares(2) } },
  { key: "trailer-michigan-11", kind: "trailer", labelKey: "equipment.templates.trailerMichigan11", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-michigan-11", axles: trailerAxles(11), spares: spares(2) } },
  { key: "trailer-no-spare", kind: "trailer", labelKey: "equipment.templates.trailerNoSpare", config: { schemaVersion: 1, kind: "trailer", templateKey: "trailer-no-spare", axles: trailerAxles(2), spares: [] } },
  { key: "jeep-2-axle", kind: "jeep", labelKey: "equipment.templates.jeep2", config: { schemaVersion: 1, kind: "jeep", templateKey: "jeep-2-axle", axles: [axle("axle-1", "trailer"), axle("axle-2", "trailer")], spares: [] } },
  { key: "jeep-3-axle", kind: "jeep", labelKey: "equipment.templates.jeep3", config: { schemaVersion: 1, kind: "jeep", templateKey: "jeep-3-axle", axles: [axle("axle-1", "trailer"), axle("axle-2", "trailer"), axle("axle-3", "trailer")], spares: [] } },
  { key: "dolly-1-axle", kind: "dolly", labelKey: "equipment.templates.dolly1", config: { schemaVersion: 1, kind: "dolly", templateKey: "dolly-1-axle", axles: [axle("axle-1", "dolly")], spares: [] } },
  { key: "dolly-2-axle", kind: "dolly", labelKey: "equipment.templates.dolly2", config: { schemaVersion: 1, kind: "dolly", templateKey: "dolly-2-axle", axles: [axle("axle-1", "dolly"), axle("axle-2", "dolly")], spares: [] } },
  { key: "booster-2-axle", kind: "booster", labelKey: "equipment.templates.booster2", config: { schemaVersion: 1, kind: "booster", templateKey: "booster-2-axle", axles: [axle("axle-1", "trailer"), axle("axle-2", "trailer")], spares: [] } },
  { key: "booster-3-axle", kind: "booster", labelKey: "equipment.templates.booster3", config: { schemaVersion: 1, kind: "booster", templateKey: "booster-3-axle", axles: [axle("axle-1", "trailer"), axle("axle-2", "trailer"), axle("axle-3", "trailer")], spares: [] } },
];

export const DEFAULT_TEMPLATE_KEY: Record<ComponentKind, string> = {
  truck: "tractor-standard",
  trailer: "trailer-2-axle",
  jeep: "jeep-2-axle",
  dolly: "dolly-1-axle",
  booster: "booster-2-axle",
};

export function templateByKey(key: string): EquipmentTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** Configuration applied to an asset that has never been configured. */
export function defaultConfigFor(kind: ComponentKind): EquipmentConfig {
  return templateByKey(DEFAULT_TEMPLATE_KEY[kind])!.config;
}

export function templatesFor(kind: ComponentKind): EquipmentTemplate[] {
  return TEMPLATES.filter((t) => t.kind === kind);
}
