import { shortId } from "../ids";
import type { LngLat } from "./valueTypes";

/** Bundles any objects into one unit: a transfer complex, a line family, a
 *  facility complex (bus bays, platforms, entrances grouped under one real
 *  physical site — see the Facility tool). */
export interface Group {
  id: string;
  name?: string;
  memberIds: string[];
  /** Physical boundary polygon, drawn in the infrastructure view — what
   *  turns a plain logical group into a facility complex with a real site. */
  footprint?: LngLat[];
  /** A facility complex's own color (distinguishes it from other complexes
   *  on the map) — hex, e.g. "#e4572e". Plain (footprint-less) groups don't
   *  need one. */
  color?: string;
}

/** A new group bundling `memberIds` (deduplicated) under `name` — the one
 *  place a bare Group literal gets constructed (see editor/store.ts's
 *  createGroup). */
export function createGroup(memberIds: string[], name?: string): Group {
  return { id: shortId(), name, memberIds: [...new Set(memberIds)] };
}
