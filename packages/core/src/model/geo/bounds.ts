import type { LngLat, TransitSystem } from "../system";

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** The bounding box of every point in the system — ways, stations (+
 *  footprints), facilities (+ polygon geometry), group footprints. Used to
 *  frame a "whole system" export/preview instead of whatever's currently on
 *  screen. Null for an empty system, so callers can fall back to the current
 *  viewport instead of fitting to nothing. */
export function systemBounds(system: TransitSystem): [LngLat, LngLat] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const grow = (c: LngLat) => {
    if (c[0] < minLng) minLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] > maxLat) maxLat = c[1];
  };
  for (const w of system.ways) w.points.forEach(grow);
  for (const st of system.stations) {
    grow(st.coord);
    st.footprint?.forEach(grow);
    st.platforms?.forEach((p) => p.points.forEach(grow));
  }
  for (const f of system.facilities) {
    if (Array.isArray(f.geometry[0])) (f.geometry as LngLat[]).forEach(grow);
    else grow(f.geometry as LngLat);
  }
  for (const g of system.groups) g.footprint?.forEach(grow);
  if (minLng === Infinity) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}
