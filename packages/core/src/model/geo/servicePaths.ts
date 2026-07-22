import type { LngLat, Pattern, Service, Way } from "../system";
import { resolveWayPath, wayById } from "./wayPath";

/** Every way a service touches across ALL its patterns, deduplicated — the
 *  right unit for "does this way carry this service" (rendering bundle/
 *  offset counts, interchange detection, …), where a service having two
 *  branches that share a trunk way must still count as ONE service on that
 *  way, not two. Use a pattern's own `wayIds` directly when you need one
 *  branch's ordered path specifically. */
export function serviceWayIds(service: Service): string[] {
  return [...new Set(service.patterns.flatMap((p) => p.wayIds))];
}

/** The concatenated resolved path a single pattern (branch) actually
 *  traces — its ways, in order, stitched into one polyline. */
export function patternPath(ways: Way[], pattern: Pattern): LngLat[] {
  const byId = wayById(ways);
  const path: LngLat[] = [];
  for (const wayId of pattern.wayIds) {
    const way = byId.get(wayId);
    const seg = way ? resolveWayPath(way) : [];
    if (seg.length < 2) continue;
    path.push(...(path.length ? seg.slice(1) : seg));
  }
  return path;
}
