import type { Map as MLMap } from "maplibre-gl";
import { FACILITY_TYPE_ORDER } from "@transitmapper/core/model/catalog";
import { facilityRender } from "../../style/catalogStyle";
import { ensureIcon } from "../icons";
import { HANDLE_INK } from "./constants";

/** Registers every icon image the symbol layers above can reference — the
 *  handle square plus one pictogram per catalog facility type. Call once,
 *  after the map's style has loaded (map.addImage needs a ready style). */
export function registerMapIcons(map: MLMap): void {
  ensureIcon(map, "square", HANDLE_INK, { fill: true });
  for (const typeId of FACILITY_TYPE_ORDER) {
    const r = facilityRender(typeId);
    ensureIcon(map, r.icon, r.color);
  }
}
