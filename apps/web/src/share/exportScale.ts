import type { Map as MLMap } from "maplibre-gl";
import { haversineMeters } from "@transitmapper/core/model/geo";

// A "nice" length for a scale bar — 1/2/5 × a power of ten — the same
// rounding cartographers use so the label reads as a round number instead of
// something like "347 m".
const NICE_STEPS = [1, 2, 5];

export function niceScaleMeters(targetMeters: number): number {
  if (targetMeters <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(targetMeters));
  const candidates = NICE_STEPS.map((s) => s * magnitude);
  // The largest nice candidate that still fits under the target — a scale
  // bar that reads longer than the distance it claims would be worse than
  // a slightly conservative one.
  return [...candidates].reverse().find((c) => c <= targetMeters) ?? candidates[0];
}

export function formatScaleMeters(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

export interface ScaleBarSpec {
  widthPx: number;
  label: string;
}

/** A scale bar sized against the given map's current zoom: the widest "nice"
 *  round-number distance whose bar still fits under `maxWidthPx`. */
export function scaleBarSpec(map: MLMap, maxWidthPx: number): ScaleBarSpec {
  const container = map.getContainer();
  const y = container.clientHeight / 2;
  const a = map.unproject([0, y]);
  const b = map.unproject([maxWidthPx, y]);
  const metersPerPixel = haversineMeters([a.lng, a.lat], [b.lng, b.lat]) / maxWidthPx;
  const niceMeters = niceScaleMeters(metersPerPixel * maxWidthPx);
  return { widthPx: niceMeters / metersPerPixel, label: formatScaleMeters(niceMeters) };
}
