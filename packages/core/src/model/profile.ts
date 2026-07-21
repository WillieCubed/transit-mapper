// Pure cross-section (profile) operations. A profile is a way's lane list,
// left-to-right facing forward (increasing point index). Everything here is
// data-in/data-out — no store, no network — so the store's profile actions
// and the migration in serialize.ts stay thin, and all of it is directly
// unit-testable.

import { LANE_KINDS, laneKind, wayType, type ProfileTemplateLane } from "./catalog";
import { shortId } from "./ids";
import type { CrossSection, DrivingSide, LaneDirection, LaneSpec, Way } from "./system";

/** Instantiate a catalog profile template into a concrete CrossSection with
 *  fresh stable lane ids; widths default from each lane kind. */
export function buildProfile(template: ProfileTemplateLane[]): CrossSection {
  return {
    lanes: template.map((t) => ({
      id: shortId(),
      kindId: t.kindId,
      widthM: t.widthM ?? laneKind(t.kindId).defaultWidthM,
      direction: t.direction,
    })),
  };
}

/**
 * The profile a way gets when only a legacy scalar capacity (+ class) is
 * known — the v5→v6 migration path, and the fallback for imported data.
 * Builds `capacity` primary travel lanes split evenly between directions
 * (odd counts get the extra forward lane; capacity 1 = one bidirectional
 * lane), wrapped in the way type's default non-primary lanes (sidewalks…).
 */
export function defaultProfileFor(typeId: string, capacity?: number): CrossSection {
  const type = wayType(typeId);
  const template = type.defaultProfile;
  const n = capacity === undefined ? undefined : Math.max(1, Math.round(capacity));
  const defaultPrimary = template.filter((t) => t.kindId === type.primaryLaneKindId).length;
  if (n === undefined || n === defaultPrimary) return buildProfile(template);

  // Rebuild: keep the template's leading/trailing non-primary lanes, replace
  // the primary block with n lanes split backward/forward.
  const leading: ProfileTemplateLane[] = [];
  const trailing: ProfileTemplateLane[] = [];
  let seenPrimary = false;
  for (const t of template) {
    if (t.kindId === type.primaryLaneKindId) {
      seenPrimary = true;
      continue;
    }
    (seenPrimary ? trailing : leading).push(t);
  }
  const primary: ProfileTemplateLane[] = [];
  if (n === 1) {
    primary.push({ kindId: type.primaryLaneKindId, direction: "both" });
  } else {
    const backward = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      primary.push({ kindId: type.primaryLaneKindId, direction: i < backward ? "backward" : "forward" });
    }
  }
  return buildProfile([...leading, ...primary, ...trailing]);
}

/** Headline capacity — how many lanes/tracks of counting kinds the profile
 *  carries (a road's "lanes", a railway's "tracks"). Replaces the stored
 *  scalar `Way.capacity` of schema v5 and earlier. A profile with no
 *  counting kinds at all (a pedestrian path is pure sidewalk) falls back to
 *  its travel-lane count so capacity never reads as zero. */
export function laneCapacity(profile: CrossSection): number {
  const counted = profile.lanes.filter((l) => laneKind(l.kindId).countsAsCapacity).length;
  return counted > 0 ? counted : travelLanes(profile).length;
}

/** Total paved/built width of the cross-section in meters. */
export function profileWidthM(profile: CrossSection): number {
  return profile.lanes.reduce((sum, l) => sum + l.widthM, 0);
}

/** Travel lanes only (drive/track/bike/sidewalk/…), in left-to-right order. */
export function travelLanes(profile: CrossSection): LaneSpec[] {
  return profile.lanes.filter((l) => laneKind(l.kindId).role === "travel");
}

/** Lanes whose direction one-way/flip operations steer (drive/track/bike…,
 *  never sidewalks or parking — see LaneKindDef.directional). */
export function directionalLanes(profile: CrossSection): LaneSpec[] {
  return profile.lanes.filter((l) => laneKind(l.kindId).directional);
}

const flipDirection = (d: LaneDirection): LaneDirection => (d === "forward" ? "backward" : d === "backward" ? "forward" : d);

/** The same physical street described facing the other way — reverses lane
 *  order and swaps forward/backward. Pairs with reversing the way's points. */
export function flipProfile(profile: CrossSection): CrossSection {
  return { lanes: [...profile.lanes].reverse().map((l) => ({ ...l, direction: flipDirection(l.direction) })) };
}

/** True when every directional lane runs the same single direction. */
export function isOneWay(profile: CrossSection): boolean {
  const dirs = new Set(directionalLanes(profile).map((l) => l.direction));
  return dirs.size === 1 && (dirs.has("forward") || dirs.has("backward"));
}

/** Make every directional lane run `direction` (one-way conversion) —
 *  sidewalks, parking, and separators are left alone. */
export function makeOneWay(profile: CrossSection, direction: "forward" | "backward"): CrossSection {
  return {
    lanes: profile.lanes.map((l) => (laneKind(l.kindId).directional ? { ...l, direction } : l)),
  };
}

/** Convert to two-way: directional lanes in the left half run backward, the
 *  right half forward under right-hand traffic (a single directional lane
 *  becomes bidirectional) — mirrored under left-hand traffic, where forward
 *  keeps to the left. */
export function makeTwoWay(profile: CrossSection, drivingSide: DrivingSide = "right"): CrossSection {
  const travel = directionalLanes(profile);
  if (travel.length === 0) return profile;
  if (travel.length === 1) {
    const only = travel[0];
    return { lanes: profile.lanes.map((l) => (l.id === only.id ? { ...l, direction: "both" as LaneDirection } : l)) };
  }
  const half = Math.floor(travel.length / 2);
  const leftHalfDirection: LaneDirection = drivingSide === "left" ? "forward" : "backward";
  const rightHalfDirection: LaneDirection = drivingSide === "left" ? "backward" : "forward";
  const directionByLaneId = new Map(travel.map((l, i) => [l.id, i < half ? leftHalfDirection : rightHalfDirection]));
  return {
    lanes: profile.lanes.map((l) => {
      const d = directionByLaneId.get(l.id);
      return d ? { ...l, direction: d } : l;
    }),
  };
}

/** Step the count of primary travel lanes (the capacity stepper's backend).
 *  Adding inserts next to the last primary lane, alternating direction to
 *  keep the split balanced; removing takes from the majority side. Which
 *  side backward lanes cluster on (front of the array vs. back) follows
 *  `drivingSide`, matching separateProfiles/makeTwoWay's convention. */
export function withLaneCount(profile: CrossSection, typeId: string, count: number, drivingSide: DrivingSide = "right"): CrossSection {
  const primaryKindId = wayType(typeId).primaryLaneKindId;
  const target = Math.max(1, Math.round(count));
  let lanes = [...profile.lanes];
  const primaries = () => lanes.filter((l) => l.kindId === primaryKindId);
  // Right-hand traffic: backward lanes cluster at the front (left) of the
  // array. Left-hand traffic mirrors this.
  const backwardAtFront = drivingSide === "right";

  // No primary lanes at all (unusual profile): seed one bidirectional lane.
  if (primaries().length === 0) {
    lanes.push({ id: shortId(), kindId: primaryKindId, widthM: laneKind(primaryKindId).defaultWidthM, direction: "both" });
  }

  while (primaries().length < target) {
    const current = primaries();
    const forward = current.filter((l) => l.direction === "forward").length;
    const backward = current.filter((l) => l.direction === "backward").length;
    const direction: LaneDirection = isOneWay(profile)
      ? current[0].direction
      : forward <= backward
        ? "forward"
        : "backward";
    // A bidirectional single lane becoming multi-lane splits into directions.
    if (current.length === 1 && current[0].direction === "both") {
      lanes = lanes.map((l) => (l.id === current[0].id ? { ...l, direction: "backward" as LaneDirection } : l));
    }
    const insertAtFront = direction === "backward" ? backwardAtFront : !backwardAtFront;
    const anchor = insertAtFront ? lanes.indexOf(primaries()[0]) : lanes.indexOf(primaries()[primaries().length - 1]) + 1;
    lanes.splice(anchor, 0, { id: shortId(), kindId: primaryKindId, widthM: laneKind(primaryKindId).defaultWidthM, direction });
  }

  while (primaries().length > target) {
    const current = primaries();
    const forward = current.filter((l) => l.direction === "forward");
    const backward = current.filter((l) => l.direction === "backward");
    const victim =
      forward.length > backward.length ? forward[0] : backward.length > 0 ? backward[backward.length - 1] : current[current.length - 1];
    lanes = lanes.filter((l) => l.id !== victim.id);
    // Collapsing to one directional lane keeps its direction; that's still
    // a valid one-lane one-way street.
  }

  return { lanes };
}

// ---- Carriageway separation / combination ----------------------------------

export interface SeparatedProfiles {
  /** Carriageway carrying the forward travel lanes (right side). */
  forward: CrossSection;
  /** Carriageway carrying the backward travel lanes (left side). */
  backward: CrossSection;
}

/**
 * Split a two-way profile into two one-way carriageway profiles around its
 * center (or around an explicit median, which is dropped — the physical gap
 * between the new ways takes its place). Each carriageway keeps its own
 * side's edge lanes; both get their own sidewalk if the source had any.
 * Under right-hand traffic the left half becomes the backward carriageway
 * and the right half forward; left-hand traffic mirrors this. Returns null
 * when the profile is already one-way (nothing to separate).
 */
export function separateProfiles(profile: CrossSection, drivingSide: DrivingSide = "right"): SeparatedProfiles | null {
  if (isOneWay(profile)) return null;
  const lanes = profile.lanes;

  // Split point: the median if present, else between the last backward-ish
  // travel lane and the first forward one.
  const medianIdx = lanes.findIndex((l) => laneKind(l.kindId).role === "separator");
  let leftLanes: LaneSpec[];
  let rightLanes: LaneSpec[];
  if (medianIdx >= 0) {
    leftLanes = lanes.slice(0, medianIdx);
    rightLanes = lanes.slice(medianIdx + 1);
  } else {
    const firstForward = lanes.findIndex((l) => laneKind(l.kindId).directional && l.direction === "forward");
    const splitAt = firstForward >= 0 ? firstForward : Math.ceil(lanes.length / 2);
    leftLanes = lanes.slice(0, splitAt);
    rightLanes = lanes.slice(splitAt);
  }

  // Bidirectional travel lanes (e.g. a center turn lane that ended up in a
  // half) become the half's own direction.
  const oneWay = (half: LaneSpec[], direction: "forward" | "backward"): CrossSection =>
    makeOneWay({ lanes: half.map((l) => ({ ...l, id: shortId() })) }, direction);

  const [backHalf, fwdHalf] = drivingSide === "left" ? [rightLanes, leftLanes] : [leftLanes, rightLanes];
  return { backward: oneWay(backHalf, "backward"), forward: oneWay(fwdHalf, "forward") };
}

/** Join two one-way carriageway profiles back into one two-way profile with
 *  a median between them. `backward` lanes come first (left half). Pass
 *  `medianWidthM`/`medianKindId` to restore a captured Median component
 *  (see model/system.ts) instead of falling back to the catalog default. */
export function combineProfiles(backward: CrossSection, forward: CrossSection, medianWidthM?: number, medianKindId?: string): CrossSection {
  const median: LaneSpec = {
    id: shortId(),
    kindId: medianKindId ?? "median",
    widthM: medianWidthM ?? LANE_KINDS.median.defaultWidthM,
    direction: "none",
  };
  return { lanes: [...backward.lanes.map((l) => ({ ...l })), median, ...forward.lanes.map((l) => ({ ...l }))] };
}

/** A deep copy of a profile with FRESH lane ids — for a new way that starts
 *  from an existing way's cross-section (e.g. a one-way branch continuing a
 *  street). Fresh ids keep junction connectors unambiguous per way. */
export function cloneProfile(profile: CrossSection): CrossSection {
  return { lanes: profile.lanes.map((l) => ({ ...l, id: shortId() })) };
}

/** Convenience: a way's derived capacity (lanes/tracks of counting kinds). */
export function wayCapacity(way: Way): number {
  return laneCapacity(way.profile);
}
