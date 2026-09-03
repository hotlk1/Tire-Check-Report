import type { PositionClass, Side } from "@/lib/tires/types";
import { defaultConfigFor } from "./templates";
import { positionClassOf, wheelPositionsOf, type AxleRole, type ComponentKind, type EquipmentConfig } from "./types";

/**
 * Inspection layout: the concrete, numbered set of tire positions an
 * inspection covers, built from the configuration snapshot of every
 * component (tractor, jeep, trailer, dolly, booster, …).
 *
 * Readings are keyed by `positionKey` (`${slot}/${axleKey}:${abbr}`), which is
 * stable when equipment is edited mid-inspection. Tire numbers are display
 * labels assigned in road order; they are stored with each inspection so
 * reports never renumber.
 */
export type ComponentSlot = "truck" | "jeep" | "trailer" | "dolly" | "booster" | "trailer2";

export const SLOT_ORDER: ComponentSlot[] = ["truck", "jeep", "trailer", "dolly", "booster", "trailer2"];

export const SLOT_KIND: Record<ComponentSlot, ComponentKind> = { truck: "truck", jeep: "jeep", trailer: "trailer", dolly: "dolly", booster: "booster", trailer2: "trailer" };

export interface LayoutComponentInput {
  slot: ComponentSlot;
  kind: ComponentKind;
  assetId: string | null;
  unitNumber: string | null;
  label?: string | null;
  configurationId: string | null;
  configVersion: number | null;
  config: EquipmentConfig;
}

export interface LayoutPosition {
  /** Display number within this inspection. */
  number: number;
  /** `${slot}/${axleKey}:${abbr}` (spares: `${slot}/${spareKey}`). */
  key: string;
  slot: ComponentSlot;
  kind: ComponentKind;
  axleKey: string;
  positionClass: PositionClass;
  side: Side;
  abbreviation: string;
  order: number;
  requiresPsi: boolean;
  isSpare: boolean;
  liftable: boolean;
}

export interface LayoutAxle {
  /** `${slot}/${axleKey}` */
  key: string;
  slot: ComponentSlot;
  kind: ComponentKind;
  role: AxleRole;
  positionClass: Exclude<PositionClass, "spare">;
  label: string | null;
  /** i18n label key (equipment.axleRoles.*) plus 1-based index among same-role axles of the component. */
  roleLabelKey: string;
  roleIndex: number;
  dual: boolean;
  liftable: boolean;
  /** Tire numbers left → right. */
  tires: number[];
}

export interface LayoutComponent {
  slot: ComponentSlot;
  kind: ComponentKind;
  assetId: string | null;
  unitNumber: string | null;
  label: string | null;
  configurationId: string | null;
  configVersion: number | null;
  templateKey: string | null;
  axles: LayoutAxle[];
  /** Tire numbers of the spare slots. */
  spares: number[];
}

export interface InspectionLayout {
  schemaVersion: 1;
  components: LayoutComponent[];
  positions: LayoutPosition[];
}

export interface NumberingOptions {
  /** Legacy numbering keeps 19/20 for tractor/trailer spares regardless of what is present. */
  legacy?: boolean;
}

const ROLE_LABEL: Record<AxleRole, string> = { steer: "equipment.axleRoles.steer", drive: "equipment.axleRoles.drive", pusher: "equipment.axleRoles.pusher", tag: "equipment.axleRoles.tag", lift: "equipment.axleRoles.lift", trailer: "equipment.axleRoles.trailer", dolly: "equipment.axleRoles.dolly" };

/** Builds the numbered layout for the given components (sorted into road order). */
export function buildLayout(inputs: LayoutComponentInput[], opts: NumberingOptions = {}): InspectionLayout {
  const ordered = [...inputs].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const positions: LayoutPosition[] = [];
  const components: LayoutComponent[] = [];
  let next = 1;

  for (const c of ordered) {
    const axles: LayoutAxle[] = [];
    const roleCount = new Map<AxleRole, number>();
    for (const a of c.config.axles) {
      const idx = (roleCount.get(a.role) ?? 0) + 1;
      roleCount.set(a.role, idx);
      const cls = positionClassOf(a.role);
      const tires: number[] = [];
      for (const w of wheelPositionsOf(a)) {
        const number = next++;
        tires.push(number);
        positions.push({ number, key: `${c.slot}/${w.key}`, slot: c.slot, kind: c.kind, axleKey: `${c.slot}/${a.key}`, positionClass: cls, side: w.side, abbreviation: w.abbreviation, order: w.order, requiresPsi: true, isSpare: false, liftable: !!a.liftable });
      }
      axles.push({ key: `${c.slot}/${a.key}`, slot: c.slot, kind: c.kind, role: a.role, positionClass: cls, label: a.label ?? null, roleLabelKey: ROLE_LABEL[a.role], roleIndex: idx, dual: a.wheels === "dual", liftable: !!a.liftable, tires });
    }
    components.push({ slot: c.slot, kind: c.kind, assetId: c.assetId, unitNumber: c.unitNumber, label: c.label ?? null, configurationId: c.configurationId, configVersion: c.configVersion, templateKey: c.config.templateKey ?? null, axles, spares: [] });
  }

  // Spares are numbered after every regular position, component by component.
  for (const c of components) {
    const cfg = ordered.find((o) => o.slot === c.slot)!.config;
    for (const s of cfg.spares) {
      const number = opts.legacy ? (c.slot === "truck" ? 19 : 20) : next++;
      c.spares.push(number);
      positions.push({ number, key: `${c.slot}/${s.key}`, slot: c.slot, kind: c.kind, axleKey: `${c.slot}/spare`, positionClass: "spare", side: "spare", abbreviation: "SP", order: c.spares.length - 1, requiresPsi: false, isSpare: true, liftable: false });
    }
  }
  return { schemaVersion: 1, components, positions };
}

/** Layout of the original fixed 20-position design for a legacy inspection mode. */
export function legacyLayout(mode: "truck" | "trailer" | "truck_trailer", assets: { truck?: { id: string; unitNumber: string } | null; trailer?: { id: string; unitNumber: string } | null } = {}): InspectionLayout {
  const inputs: LayoutComponentInput[] = [];
  if (mode !== "trailer") inputs.push({ slot: "truck", kind: "truck", assetId: assets.truck?.id ?? null, unitNumber: assets.truck?.unitNumber ?? null, configurationId: null, configVersion: null, config: defaultConfigFor("truck") });
  if (mode !== "truck") inputs.push({ slot: "trailer", kind: "trailer", assetId: assets.trailer?.id ?? null, unitNumber: assets.trailer?.unitNumber ?? null, configurationId: null, configVersion: null, config: defaultConfigFor("trailer") });
  // Trailer-only legacy inspections numbered trailer tires 11–18: shift by the tractor's ten positions.
  const layout = buildLayout(inputs, { legacy: true });
  if (mode === "trailer") {
    for (const p of layout.positions) if (!p.isSpare) p.number += 10;
    for (const c of layout.components) for (const a of c.axles) a.tires = a.tires.map((n) => n + 10);
  }
  return layout;
}

export function positionByNumber(layout: InspectionLayout, number: number): LayoutPosition | undefined {
  return layout.positions.find((p) => p.number === number);
}

export function positionByKey(layout: InspectionLayout, key: string): LayoutPosition | undefined {
  return layout.positions.find((p) => p.key === key);
}

export function axleByKey(layout: InspectionLayout, key: string): LayoutAxle | undefined {
  for (const c of layout.components) for (const a of c.axles) if (a.key === key) return a;
  return undefined;
}

export function requiredNumbers(layout: InspectionLayout): number[] {
  return layout.positions.filter((p) => !p.isSpare).map((p) => p.number);
}

export function spareNumbers(layout: InspectionLayout): number[] {
  return layout.positions.filter((p) => p.isSpare).map((p) => p.number);
}

/** Legacy "mode" of a layout for the existing enum column / reports. */
export function modeOf(layout: InspectionLayout): "truck" | "trailer" | "truck_trailer" | "combination" {
  const slots = new Set(layout.components.map((c) => c.slot));
  const extra = [...slots].some((s) => s !== "truck" && s !== "trailer");
  if (extra) return "combination";
  if (slots.has("truck") && slots.has("trailer")) return "truck_trailer";
  return slots.has("truck") ? "truck" : "trailer";
}

/** Structural check of a stored layout snapshot. */
export function isInspectionLayout(x: unknown): x is InspectionLayout {
  if (!x || typeof x !== "object") return false;
  const l = x as InspectionLayout;
  return l.schemaVersion === 1 && Array.isArray(l.components) && Array.isArray(l.positions);
}
