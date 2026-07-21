// The single source of *kinds* in the app. Everything the model, tools, and
// inspector know about way types, service modes, grades, and facility
// classes lives here as DATA — not as union types baked into logic. This is
// pure domain data: what exists, what's compatible with what, what it's
// measured in. How it's drawn is a separate concern — see style/catalogStyle.ts.
//
// Adding a new way type (monorail guideway, gondola span, ferry route) or a new
// mode (funicular, trolleybus) is a catalog entry here, never a type or switch
// change elsewhere. Records in system.ts reference these by string id.

// ---- Facility classes ------------------------------------------------------
// A per-way-type refinement of the physical right-of-way: a road's arterial vs.
// local, a bike way's protected vs. painted.

export interface FacilityClass {
  id: string;
  label: string;
}

// ---- Lane kinds ------------------------------------------------------------
// One element of a way's cross-section, left-to-right: a drive lane, a rail
// track, a median, a sidewalk. Like way types, lane kinds are catalog DATA —
// a way's profile references them by id, and adding a new kind (e.g. a
// transit-only queue-jump lane) is an entry here, never a union change.
// Widths are stored in meters; the UI presents feet.

/** What a lane element does in the cross-section: carries moving traffic
 *  (vehicles, trains, bikes, pedestrians), separates other lanes (median,
 *  buffer), or sits at the edge of the traveled way (parking, shoulder). */
export type LaneRole = "travel" | "separator" | "edge";

export interface LaneKindDef {
  id: string;
  label: string;
  role: LaneRole;
  defaultWidthM: number;
  /** Common widths offered as one-click presets, in meters. */
  widthPresetsM: number[];
  /** Whether lanes of this kind count toward the way's headline capacity
   *  (a road's "lanes", a railway's "tracks"). Sidewalks and medians don't. */
  countsAsCapacity: boolean;
  /** Whether one-way/flip operations steer this kind's direction. Drive
   *  lanes and tracks are directional; a one-way street's sidewalks stay
   *  bidirectional for the people on them. */
  directional: boolean;
}

const FT = 0.3048;

export const LANE_KINDS: Record<string, LaneKindDef> = {
  drive: {
    id: "drive",
    label: "Drive lane",
    role: "travel",
    defaultWidthM: 11 * FT,
    widthPresetsM: [10 * FT, 11 * FT, 12 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  bus: {
    id: "bus",
    label: "Bus lane",
    role: "travel",
    defaultWidthM: 12 * FT,
    widthPresetsM: [11 * FT, 12 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  turnPocket: {
    id: "turnPocket",
    label: "Turn lane",
    role: "travel",
    defaultWidthM: 10 * FT,
    widthPresetsM: [10 * FT, 11 * FT],
    countsAsCapacity: false,
    directional: true,
  },
  bike: {
    id: "bike",
    label: "Bike lane",
    role: "travel",
    defaultWidthM: 6 * FT,
    widthPresetsM: [5 * FT, 6 * FT, 8 * FT],
    countsAsCapacity: true,
    directional: true,
  },
  sidewalk: {
    id: "sidewalk",
    label: "Sidewalk",
    role: "travel",
    defaultWidthM: 6 * FT,
    widthPresetsM: [5 * FT, 6 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  parking: {
    id: "parking",
    label: "Parking",
    role: "edge",
    defaultWidthM: 8 * FT,
    widthPresetsM: [7 * FT, 8 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  shoulder: {
    id: "shoulder",
    label: "Shoulder",
    role: "edge",
    defaultWidthM: 6 * FT,
    widthPresetsM: [4 * FT, 6 * FT, 10 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  median: {
    id: "median",
    label: "Median",
    role: "separator",
    defaultWidthM: 4 * FT,
    widthPresetsM: [2 * FT, 4 * FT, 10 * FT, 16 * FT],
    countsAsCapacity: false,
    directional: false,
  },
  track: {
    id: "track",
    label: "Track",
    role: "travel",
    defaultWidthM: 4,
    widthPresetsM: [3.5, 4, 4.5],
    countsAsCapacity: true,
    directional: true,
  },
  platform: {
    id: "platform",
    label: "Platform",
    role: "separator",
    defaultWidthM: 6,
    widthPresetsM: [3, 6, 9],
    countsAsCapacity: false,
    directional: false,
  },
  // Aerial ropeway span / navigable water lane — one operating channel.
  channel: {
    id: "channel",
    label: "Channel",
    role: "travel",
    defaultWidthM: 15,
    widthPresetsM: [10, 15, 30],
    countsAsCapacity: true,
    directional: true,
  },
};

export function laneKind(id: string): LaneKindDef {
  return LANE_KINDS[id] ?? LANE_KINDS.drive;
}

// ---- Way types -------------------------------------------------------------
// The physical carrier. `family` groups types for the UI and view filters;
// `capacityLabel` names the unit a way of this type is measured in.

export type WayFamily = "guideway" | "roadway" | "path" | "aerial" | "water";

// What a shared identity (NamedWay) across several ways of this family is
// called in the UI: two road carriageways form a "Street", two rail tracks a
// "Line", a walking/biking alignment a "Trail".
export interface WayFamilyInfo {
  identityNoun: string;
  /** What the family's DRAWING TOOL is called — the one-click "just draw a
   *  road / a track" buttons in the Infrastructure toolbar are generated
   *  from the families, one tool each. */
  toolLabel: string;
}

export const WAY_FAMILIES: Record<WayFamily, WayFamilyInfo> = {
  guideway: { identityNoun: "Line", toolLabel: "Track" },
  roadway: { identityNoun: "Street", toolLabel: "Road" },
  path: { identityNoun: "Trail", toolLabel: "Path" },
  aerial: { identityNoun: "Line", toolLabel: "Aerial" },
  water: { identityNoun: "Route", toolLabel: "Ferry" },
};

/** Way-type ids grouped by family, in WAY_TYPE_ORDER order — the source the
 *  toolbar's per-family drawing tools (and their variant flyouts) are
 *  generated from. */
export function wayTypesByFamily(): { family: WayFamily; typeIds: string[] }[] {
  const out: { family: WayFamily; typeIds: string[] }[] = [];
  for (const id of WAY_TYPE_ORDER) {
    const family = WAY_TYPES[id].family;
    let entry = out.find((e) => e.family === family);
    if (!entry) {
      entry = { family, typeIds: [] };
      out.push(entry);
    }
    entry.typeIds.push(id);
  }
  return out;
}

/** One lane in a catalog profile template — widths default from the lane
 *  kind; instances get ids when the template is built into a CrossSection
 *  (see model/profile.ts buildProfile). */
export interface ProfileTemplateLane {
  kindId: string;
  direction: "forward" | "backward" | "both" | "none";
  widthM?: number;
}

export interface WayType {
  id: string;
  label: string;
  family: WayFamily;
  /** Unit the way's derived capacity counts: "tracks", "lanes", "cabins/hr", … */
  capacityLabel: string;
  defaultCapacity: number;
  /** Facility classes for this type (may be empty). */
  classes: FacilityClass[];
  /** Default class id for a new way of this type, if the type has classes. */
  defaultClassId?: string;
  /** Lane kinds a way of this type may include in its cross-section. */
  laneKindIds: string[];
  /** The kind added/removed when capacity is stepped (drive, track, …). */
  primaryLaneKindId: string;
  /** Cross-section a new way of this type starts with. */
  defaultProfile: ProfileTemplateLane[];
}

export const WAY_TYPES: Record<string, WayType> = {
  // Heavy rail and light rail are physically incompatible track standards —
  // different gauge/loading/signaling — so each is its own way type, never a
  // class of one "rail" type. Subway and commuter rail share heavy rail
  // trackage; light rail and trams/streetcars share light rail trackage;
  // monorail is a third, wholly separate guideway standard. Two of these can
  // run parallel alignments to save space, but can never be the same Way.
  heavyRail: {
    id: "heavyRail",
    label: "Heavy rail",
    family: "guideway",
    capacityLabel: "tracks",
    defaultCapacity: 2,
    classes: [],
    laneKindIds: ["track", "platform"],
    primaryLaneKindId: "track",
    defaultProfile: [
      { kindId: "track", direction: "backward" },
      { kindId: "track", direction: "forward" },
    ],
  },
  lightRail: {
    id: "lightRail",
    label: "Light rail / tram",
    family: "guideway",
    capacityLabel: "tracks",
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ["track", "platform"],
    primaryLaneKindId: "track",
    defaultProfile: [{ kindId: "track", direction: "both", widthM: 3.5 }],
  },
  monorail: {
    id: "monorail",
    label: "Monorail",
    family: "guideway",
    capacityLabel: "beams",
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ["track", "platform"],
    primaryLaneKindId: "track",
    defaultProfile: [{ kindId: "track", direction: "both", widthM: 2 }],
  },
  road: {
    id: "road",
    label: "Road",
    family: "roadway",
    capacityLabel: "lanes",
    defaultCapacity: 4,
    defaultClassId: "arterial",
    classes: [
      { id: "transitway", label: "Transitway" },
      { id: "arterial", label: "Arterial" },
      { id: "collector", label: "Collector" },
      { id: "local", label: "Local" },
    ],
    laneKindIds: ["drive", "bus", "turnPocket", "bike", "parking", "shoulder", "median", "sidewalk", "track"],
    primaryLaneKindId: "drive",
    defaultProfile: [
      { kindId: "sidewalk", direction: "both" },
      { kindId: "drive", direction: "backward" },
      { kindId: "drive", direction: "backward" },
      { kindId: "drive", direction: "forward" },
      { kindId: "drive", direction: "forward" },
      { kindId: "sidewalk", direction: "both" },
    ],
  },
  bike: {
    id: "bike",
    label: "Bike",
    family: "path",
    capacityLabel: "width",
    defaultCapacity: 1,
    defaultClassId: "protected",
    classes: [
      { id: "protected", label: "Protected track" },
      { id: "buffered", label: "Buffered lane" },
      { id: "painted", label: "Painted lane" },
      { id: "path", label: "Off-street path" },
      { id: "greenway", label: "Neighborhood greenway" },
    ],
    laneKindIds: ["bike", "sidewalk", "median"],
    primaryLaneKindId: "bike",
    defaultProfile: [{ kindId: "bike", direction: "both" }],
  },
  pedestrian: {
    id: "pedestrian",
    label: "Pedestrian",
    family: "path",
    capacityLabel: "width",
    defaultCapacity: 1,
    defaultClassId: "promenade",
    classes: [
      { id: "promenade", label: "Promenade / mall" },
      { id: "pathway", label: "Pathway" },
      { id: "stairs", label: "Stairs / passage" },
    ],
    laneKindIds: ["sidewalk", "bike", "median"],
    primaryLaneKindId: "sidewalk",
    defaultProfile: [{ kindId: "sidewalk", direction: "both", widthM: 3 }],
  },
  aerial: {
    id: "aerial",
    label: "Aerial / gondola",
    family: "aerial",
    capacityLabel: "cabins/hr",
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ["channel"],
    primaryLaneKindId: "channel",
    defaultProfile: [{ kindId: "channel", direction: "both" }],
  },
  water: {
    id: "water",
    label: "Ferry route",
    family: "water",
    capacityLabel: "vessels",
    defaultCapacity: 1,
    classes: [],
    laneKindIds: ["channel"],
    primaryLaneKindId: "channel",
    defaultProfile: [{ kindId: "channel", direction: "both" }],
  },
};

export const WAY_TYPE_ORDER: string[] = ["heavyRail", "lightRail", "monorail", "road", "bike", "pedestrian", "aerial", "water"];

// ---- Profile presets --------------------------------------------------------
// One-click cross-sections offered when drawing or editing a way — "pick a
// preset and drag" is the turnkey path; the lane editor refines from there.

export interface ProfilePreset {
  id: string;
  label: string;
  wayTypeId: string;
  /** Facility class a way gets when this preset is applied, if any. */
  classId?: string;
  lanes: ProfileTemplateLane[];
}

const SIDEWALK: ProfileTemplateLane = { kindId: "sidewalk", direction: "both" };
const DRIVE_F: ProfileTemplateLane = { kindId: "drive", direction: "forward" };
const DRIVE_B: ProfileTemplateLane = { kindId: "drive", direction: "backward" };

export const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  roadLocal2: {
    id: "roadLocal2",
    label: "2-lane local",
    wayTypeId: "road",
    classId: "local",
    lanes: [SIDEWALK, { kindId: "parking", direction: "none" }, DRIVE_B, DRIVE_F, { kindId: "parking", direction: "none" }, SIDEWALK],
  },
  roadCollector3: {
    id: "roadCollector3",
    label: "3-lane w/ center turn",
    wayTypeId: "road",
    classId: "collector",
    lanes: [SIDEWALK, { kindId: "bike", direction: "backward" }, DRIVE_B, { kindId: "turnPocket", direction: "both" }, DRIVE_F, { kindId: "bike", direction: "forward" }, SIDEWALK],
  },
  roadArterial4: {
    id: "roadArterial4",
    label: "4-lane arterial",
    wayTypeId: "road",
    classId: "arterial",
    lanes: [SIDEWALK, DRIVE_B, DRIVE_B, DRIVE_F, DRIVE_F, SIDEWALK],
  },
  roadArterial5: {
    id: "roadArterial5",
    label: "5-lane w/ center turn",
    wayTypeId: "road",
    classId: "arterial",
    lanes: [SIDEWALK, DRIVE_B, DRIVE_B, { kindId: "turnPocket", direction: "both" }, DRIVE_F, DRIVE_F, SIDEWALK],
  },
  roadBoulevard: {
    id: "roadBoulevard",
    label: "Divided boulevard",
    wayTypeId: "road",
    classId: "arterial",
    lanes: [
      SIDEWALK,
      { kindId: "bike", direction: "backward" },
      DRIVE_B,
      DRIVE_B,
      { kindId: "median", direction: "none", widthM: 16 * FT },
      DRIVE_F,
      DRIVE_F,
      { kindId: "bike", direction: "forward" },
      SIDEWALK,
    ],
  },
  roadOneWay3: {
    id: "roadOneWay3",
    label: "3-lane one-way",
    wayTypeId: "road",
    classId: "arterial",
    lanes: [SIDEWALK, { kindId: "parking", direction: "none" }, DRIVE_F, DRIVE_F, DRIVE_F, SIDEWALK],
  },
  roadTransitway: {
    id: "roadTransitway",
    label: "Transitway",
    wayTypeId: "road",
    classId: "transitway",
    lanes: [SIDEWALK, { kindId: "bus", direction: "backward" }, { kindId: "bus", direction: "forward" }, SIDEWALK],
  },
  railSingle: {
    id: "railSingle",
    label: "Single track",
    wayTypeId: "heavyRail",
    lanes: [{ kindId: "track", direction: "both" }],
  },
  railDouble: {
    id: "railDouble",
    label: "Double track",
    wayTypeId: "heavyRail",
    lanes: [
      { kindId: "track", direction: "backward" },
      { kindId: "track", direction: "forward" },
    ],
  },
  railQuad: {
    id: "railQuad",
    label: "Quad track",
    wayTypeId: "heavyRail",
    lanes: [
      { kindId: "track", direction: "backward" },
      { kindId: "track", direction: "backward" },
      { kindId: "track", direction: "forward" },
      { kindId: "track", direction: "forward" },
    ],
  },
};

export const PROFILE_PRESET_ORDER: string[] = [
  "roadLocal2",
  "roadCollector3",
  "roadArterial4",
  "roadArterial5",
  "roadBoulevard",
  "roadOneWay3",
  "roadTransitway",
  "railSingle",
  "railDouble",
  "railQuad",
];

/** Presets for a way type, in catalog order. */
export function profilePresetsForWayType(typeId: string): ProfilePreset[] {
  return PROFILE_PRESET_ORDER.map((id) => PROFILE_PRESETS[id]).filter((p) => p.wayTypeId === typeId);
}

// ---- Service modes ---------------------------------------------------------
// A colored service that people ride. `wayTypeIds` are the way types this mode
// can run over — so the mode picker for a way type shows only compatible modes,
// and a service can span any way of a compatible type.

export interface Mode {
  id: string;
  label: string;
  /** Way types this mode is compatible with. */
  wayTypeIds: string[];
}

export const MODES: Record<string, Mode> = {
  // Heavy rail: subway and commuter rail are operationally different services
  // but ride the same track standard, so both are compatible with heavyRail.
  subway: { id: "subway", label: "Subway / metro", wayTypeIds: ["heavyRail"] },
  commuterRail: { id: "commuterRail", label: "Commuter rail", wayTypeIds: ["heavyRail"] },
  // Light rail & trams share the light-rail track standard — trams typically
  // run shorter, city-center alignments and more often street-run in a road's
  // right-of-way, which is why both also list "road" as compatible.
  lightRail: { id: "lightRail", label: "Light rail", wayTypeIds: ["lightRail", "road"] },
  tram: { id: "tram", label: "Tram / streetcar", wayTypeIds: ["lightRail", "road"] },
  monorail: { id: "monorail", label: "Monorail", wayTypeIds: ["monorail"] },
  brt: { id: "brt", label: "BRT", wayTypeIds: ["road"] },
  bus: { id: "bus", label: "Bus", wayTypeIds: ["road"] },
  gondola: { id: "gondola", label: "Gondola / aerial", wayTypeIds: ["aerial"] },
  ferry: { id: "ferry", label: "Ferry", wayTypeIds: ["water"] },
};

export const MODE_ORDER: string[] = [
  "subway",
  "lightRail",
  "tram",
  "monorail",
  "brt",
  "bus",
  "commuterRail",
  "gondola",
  "ferry",
];

/** Modes compatible with a way type, in catalog order. */
export function modesForWayType(typeId: string): Mode[] {
  return MODE_ORDER.map((id) => MODES[id]).filter((m) => m.wayTypeIds.includes(typeId));
}

// ---- Grade -----------------------------------------------------------------
// Vertical alignment of a way: below ground, at grade, or elevated.

export type Grade = "underground" | "atGrade" | "elevated";

export interface GradeInfo {
  label: string;
}

export const GRADES: Record<Grade, GradeInfo> = {
  underground: { label: "Underground" },
  atGrade: { label: "At grade" },
  elevated: { label: "Elevated" },
};

export const GRADE_ORDER: Grade[] = ["underground", "atGrade", "elevated"];

// ---- Facility types ---------------------------------------------------------
// Catalog-typed point/area features that aren't ways or stations in their own
// right: a bike dock, a station entrance, a depot/yard. `geometryKind` says
// whether a placed Facility is a single point or an area (polygon) — not to
// be confused with `FacilityClass` above, which refines a WAY's right-of-way
// (arterial vs. local), a different axis entirely.

export type FacilityGeometryKind = "point" | "area";

export interface FacilityType {
  id: string;
  label: string;
  geometryKind: FacilityGeometryKind;
}

export const FACILITY_TYPES: Record<string, FacilityType> = {
  entrance: { id: "entrance", label: "Entrance", geometryKind: "point" },
  bikeDock: { id: "bikeDock", label: "Bike dock", geometryKind: "point" },
  elevator: { id: "elevator", label: "Elevator", geometryKind: "point" },
  // A station building / terminal / headhouse — the general-purpose drawn
  // structure that sits on station land alongside platforms and bus bays.
  building: { id: "building", label: "Building", geometryKind: "area" },
  parkingLot: { id: "parkingLot", label: "Parking", geometryKind: "area" },
  depot: { id: "depot", label: "Depot / yard", geometryKind: "area" },
  // A bus's curbside stopping bay and a boarding platform (rail/tram/BRT
  // alike) both have a real footprint — placed inside a facility boundary
  // the same way a station's platforms sit inside its own footprint.
  busBay: { id: "busBay", label: "Bus bay", geometryKind: "area" },
  platform: { id: "platform", label: "Platform", geometryKind: "area" },
};

export const FACILITY_TYPE_ORDER: string[] = ["entrance", "bikeDock", "elevator", "building", "busBay", "platform", "parkingLot", "depot"];

export function facilityType(id: string): FacilityType {
  return FACILITY_TYPES[id] ?? FACILITY_TYPES.entrance;
}

// ---- Accessors (tolerant of unknown ids, so bad data never crashes) --------
export function wayType(id: string): WayType {
  return WAY_TYPES[id] ?? WAY_TYPES.lightRail;
}

export function mode(id: string): Mode {
  return MODES[id] ?? MODES.bus;
}

/** Facility class within a way type, or undefined if none/unknown. */
export function facilityClass(typeId: string, classId: string | undefined): FacilityClass | undefined {
  if (!classId) return undefined;
  return WAY_TYPES[typeId]?.classes.find((c) => c.id === classId);
}
