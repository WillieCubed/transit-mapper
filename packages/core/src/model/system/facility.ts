import { shortId } from "../ids";
import type { LngLat } from "./valueTypes";

/** A catalog-typed point/area feature: bike dock, entrance, depot, … */
export interface Facility {
  id: string;
  /** Facility-type catalog id. */
  typeId: string;
  name?: string;
  /** A single point, or a polygon boundary. */
  geometry: LngLat | LngLat[];
}

/** A new facility of the given catalog type at `geometry` — the one place a
 *  bare Facility literal gets constructed (see editor/store.ts's
 *  addFacility). */
export function createFacility(typeId: string, geometry: LngLat | LngLat[]): Facility {
  return { id: shortId(), typeId, geometry };
}
