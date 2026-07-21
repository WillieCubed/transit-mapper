// Generic component-map helpers — the smallest possible "ECS core" for
// capabilities that don't belong on any single record's own interface
// (turn restrictions, medians, per-approach control). A component is just a
// Record<string, T> keyed by some entity/sub-entity reference string, stored
// alongside the entity arrays on TransitSystem (see system.ts), and updated
// with the same copy-on-write convention the store already uses everywhere.
// Not a framework: existing fields (Way.profile, Way.geometry, …) are not
// migrated into components — only genuinely new capabilities go through
// this registry.

export type EntityId = string;
export type ComponentMap<T> = Record<string, T>;

export function getComponent<T>(map: ComponentMap<T>, key: EntityId): T | undefined {
  return map[key];
}

export function withComponent<T>(map: ComponentMap<T>, key: EntityId, value: T): ComponentMap<T> {
  return { ...map, [key]: value };
}

export function withoutComponent<T>(map: ComponentMap<T>, key: EntityId): ComponentMap<T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/** A lane ref key, stable for TurnRestriction — matches LaneConnector's own
 *  {wayId, laneId} shape so the two concepts key identically. */
export function laneRefKey(wayId: string, laneId: string): EntityId {
  return `${wayId}:${laneId}`;
}

/** An arm ref key (one way-end meeting a junction), for ApproachControl. */
export function armRefKey(wayId: string, end: "start" | "end"): EntityId {
  return `${wayId}:${end}`;
}
