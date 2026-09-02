/** Sequential single-hue cell color (light → dark) for magnitude heatmaps. Server- and client-safe. */
export function heatColor(value: number | null, min: number, max: number, invert = false): string {
  if (value === null) return "var(--surface-3)";
  const t0 = max === min ? 0.5 : (value - min) / (max - min);
  const t = invert ? 1 - t0 : t0;
  const l = 96 - t * 60; // lightness 96 → 36 on the accent hue
  return `hsl(221 83% ${l}%)`;
}
