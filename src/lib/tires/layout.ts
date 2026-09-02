import type { AxleDefinition, InspectionMode, TirePosition, VehicleKind } from "./types";

/**
 * Canonical tire layout (spec §5).
 *
 * Tractor: 1 = left steer, 2 = right steer, 3–6 first drive axle duals,
 *          7–10 second drive axle duals.
 * Trailer: 11–14 first trailer axle duals, 15–18 second trailer axle duals.
 * Spares:  19 (truck), 20 (trailer).
 *
 * Dual order left→right is: LO, LI, RI, RO.
 */

const dual = (
  vehicle: VehicleKind,
  positionClass: "drive" | "trailer",
  axleKey: string,
  first: number,
): TirePosition[] => {
  const labels: Array<[string, "left" | "right", string]> = [
    ["LO", "left", "leftOuter"],
    ["LI", "left", "leftInner"],
    ["RI", "right", "rightInner"],
    ["RO", "right", "rightOuter"],
  ];
  return labels.map(([abbreviation, side, key], i) => ({
    number: first + i,
    vehicle,
    positionClass,
    axleKey,
    side,
    abbreviation,
    labelKey: `tires.position.${key}`,
    order: i,
    requiresPsi: true,
  }));
};

export const TIRE_POSITIONS: TirePosition[] = [
  {
    number: 1,
    vehicle: "truck",
    positionClass: "steer",
    axleKey: "truck-steer",
    side: "left",
    abbreviation: "L",
    labelKey: "tires.position.leftSteer",
    order: 0,
    requiresPsi: true,
  },
  {
    number: 2,
    vehicle: "truck",
    positionClass: "steer",
    axleKey: "truck-steer",
    side: "right",
    abbreviation: "R",
    labelKey: "tires.position.rightSteer",
    order: 1,
    requiresPsi: true,
  },
  ...dual("truck", "drive", "truck-drive-1", 3),
  ...dual("truck", "drive", "truck-drive-2", 7),
  ...dual("trailer", "trailer", "trailer-axle-1", 11),
  ...dual("trailer", "trailer", "trailer-axle-2", 15),
  {
    number: 19,
    vehicle: "truck",
    positionClass: "spare",
    axleKey: "truck-spare",
    side: "spare",
    abbreviation: "SP",
    labelKey: "tires.position.truckSpare",
    order: 0,
    requiresPsi: false,
  },
  {
    number: 20,
    vehicle: "trailer",
    positionClass: "spare",
    axleKey: "trailer-spare",
    side: "spare",
    abbreviation: "SP",
    labelKey: "tires.position.trailerSpare",
    order: 0,
    requiresPsi: false,
  },
];

export const POSITION_BY_NUMBER: ReadonlyMap<number, TirePosition> = new Map(
  TIRE_POSITIONS.map((p) => [p.number, p]),
);

export function getPosition(number: number): TirePosition {
  const p = POSITION_BY_NUMBER.get(number);
  if (!p) throw new Error(`Unknown tire number ${number}`);
  return p;
}

export const AXLES: AxleDefinition[] = [
  { key: "truck-steer", vehicle: "truck", positionClass: "steer", labelKey: "tires.axle.steer", tires: [1, 2], dual: false },
  { key: "truck-drive-1", vehicle: "truck", positionClass: "drive", labelKey: "tires.axle.drive1", tires: [3, 4, 5, 6], dual: true },
  { key: "truck-drive-2", vehicle: "truck", positionClass: "drive", labelKey: "tires.axle.drive2", tires: [7, 8, 9, 10], dual: true },
  { key: "trailer-axle-1", vehicle: "trailer", positionClass: "trailer", labelKey: "tires.axle.trailer1", tires: [11, 12, 13, 14], dual: true },
  { key: "trailer-axle-2", vehicle: "trailer", positionClass: "trailer", labelKey: "tires.axle.trailer2", tires: [15, 16, 17, 18], dual: true },
];

export const SPARES: Record<VehicleKind, number> = { truck: 19, trailer: 20 };

export function vehiclesForMode(mode: InspectionMode): VehicleKind[] {
  if (mode === "truck") return ["truck"];
  if (mode === "trailer") return ["trailer"];
  return ["truck", "trailer"];
}

/** Regular (non-spare) tire numbers that must be completed for a given mode. */
export function requiredTiresForMode(mode: InspectionMode): number[] {
  const vehicles = vehiclesForMode(mode);
  return TIRE_POSITIONS.filter((p) => vehicles.includes(p.vehicle) && p.positionClass !== "spare").map((p) => p.number);
}

/** All tire numbers shown on the diagram for a mode, spares included. */
export function tiresForMode(mode: InspectionMode): number[] {
  const vehicles = vehiclesForMode(mode);
  return TIRE_POSITIONS.filter((p) => vehicles.includes(p.vehicle)).map((p) => p.number);
}

export function axlesForMode(mode: InspectionMode): AxleDefinition[] {
  const vehicles = vehiclesForMode(mode);
  return AXLES.filter((a) => vehicles.includes(a.vehicle));
}

export function isSpare(number: number): boolean {
  return getPosition(number).positionClass === "spare";
}
