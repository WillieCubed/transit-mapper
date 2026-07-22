import type { LngLat, NodeControl } from "./valueTypes";
import type { WayPointRef } from "./way";

/** One edge of a junction's lane-connectivity graph: a specific incoming
 *  lane continues into a specific outgoing lane. Turn arrows painted on
 *  approach lanes are derived from these, never stored separately. */
export interface LaneConnector {
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

/** A lane-level turn restriction: the specific Ways this lane may feed at
 *  its next junction, keyed by TARGET WAY IDENTITY — never by a geometric
 *  turn classification (left/straight/right). Angle-bucket classification
 *  is ambiguous at any junction with two arms in the same coarse bucket (a
 *  Y-split, a genuine 5-way) and meaningless at a roundabout; target-way
 *  identity has neither problem. An empty list means the lane is fully
 *  blocked from continuing past this point — how modal filters are
 *  expressed (no separate concept needed: restrict a lane kind to
 *  `allowedTargets: []` at an ordinary split point). Absent = unrestricted.
 *  Keyed by `${wayId}:${laneId}` — see components.ts's laneRefKey. */
export interface TurnRestriction {
  allowedTargets: string[];
}

/**
 * A junction: a coordinate genuinely shared by two or more ways' control
 * points (not just two paths that happen to cross visually). `refs` are kept
 * in sync with `Way.points` by every store mutation that inserts, deletes, or
 * moves a control point — see editor/store.ts's cascadeMove/shiftNodeRefsFor*.
 */
export interface Node {
  id: string;
  coord: LngLat;
  refs: WayPointRef[];
  /** Traffic control at this junction. Undefined = uncontrolled. */
  control?: NodeControl;
  /** Explicit lane-connectivity graph — stored only once the user customizes
   *  turn lanes; otherwise connectors are derived by heuristic on demand. */
  connectors?: LaneConnector[];
}

/** Traffic control for one specific approach to a junction (e.g. a stop
 *  sign on the minor street only, a signal on one leg of an otherwise
 *  uncontrolled crossing) — one granularity finer than Node.control, which
 *  applies to the whole junction. Falls back to the node's whole-node
 *  control when unset. Keyed by `${wayId}:${end}` — see components.ts's
 *  armRefKey. */
export interface ApproachControl {
  control: NodeControl;
}
