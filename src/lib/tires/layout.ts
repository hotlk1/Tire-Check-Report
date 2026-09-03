/**
 * Legacy fixed 20-position layout (spec §5), retained for reading inspections
 * submitted before equipment configurations existed and for migrations.
 * New code renders from the inspection's stored layout snapshot
 * (see `@/lib/equipment/layout`).
 */
export { legacyLayout } from "@/lib/equipment/layout";

/** Position codes of the legacy layout by tire number (1–20). */
export const LEGACY_POSITION_CODES: Record<number, string> = {
  1: "L", 2: "R",
  3: "LO", 4: "LI", 5: "RI", 6: "RO",
  7: "LO", 8: "LI", 9: "RI", 10: "RO",
  11: "LO", 12: "LI", 13: "RI", 14: "RO",
  15: "LO", 16: "LI", 17: "RI", 18: "RO",
  19: "SP", 20: "SP",
};
