import type { ViewOptions } from "../map/layers";
import type { TransitSystem } from "../model/system";

export interface LegendEntry {
  color: string;
  label: string;
}

/** One legend row per visible service — the MTA-map convention of a colored
 *  swatch next to the line's name. Shared by the PNG canvas compositor and
 *  the SVG markup builder so both exports show the same legend. */
export function legendEntriesFor(system: TransitSystem, view: ViewOptions): LegendEntry[] {
  return system.services
    .filter((sv) => view.visibleModes.has(sv.modeId))
    .map((sv) => ({ color: sv.color, label: sv.name || "Unnamed line" }));
}
