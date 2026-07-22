import type { ComponentMap } from "../components";
import type { Facility } from "./facility";
import type { Group } from "./group";
import type { NamedWay, Median } from "./namedWay";
import type { ApproachControl, Node, TurnRestriction } from "./node";
import type { Service } from "./service";
import type { Station } from "./station";
import type { DrivingSide, Viewport } from "./valueTypes";
import type { Way } from "./way";

export interface TransitSystem {
  /** Schema version, for migrations. */
  version: 8;
  id: string;
  name: string;
  description?: string;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  ways: Way[];
  services: Service[];
  stations: Station[];
  facilities: Facility[];
  groups: Group[];
  /** Explicit junctions — coordinates genuinely shared by 2+ ways' control
   *  points. See Node. */
  nodes: Node[];
  /** Shared identities across ways ("Decatur Avenue"). See NamedWay. */
  namedWays: NamedWay[];
  /** Common colors for this system — offered in the color popover. */
  palette: string[];
  /** Which side of the road forward traffic keeps to — see DrivingSide. */
  drivingSide: DrivingSide;
  /** Per-lane turn restrictions — see TurnRestriction. */
  turnRestrictions: ComponentMap<TurnRestriction>;
  /** Medians/separators between a NamedWay's carriageways — see Median. */
  medians: ComponentMap<Median>;
  /** Per-approach traffic control overrides — see ApproachControl. */
  approachControls: ComponentMap<ApproachControl>;
}

// A new system frames the whole Las Vegas Valley — Strip, Henderson, North Las
// Vegas, Paradise — not a single downtown. Only a starting bookmark, never a
// constraint on where a system can be drawn.
export const DEFAULT_VIEWPORT: Viewport = {
  center: [-115.176, 36.13],
  zoom: 10.4,
};
