import type { ScheduleDayScope } from "./valueTypes";

/** One path a service runs — more than one on the same service models a
 *  branch/variant sharing that service's identity (name/color/mode), e.g. a
 *  trunk splitting into an airport branch and a downtown branch. */
export interface Pattern {
  id: string;
  /** Ordered ways this pattern runs over (its path; may span way types). */
  wayIds: string[];
  /** Optional label for a specific branch/variant, e.g. "via Airport". */
  name?: string;
}

/** One named headway period within a service's full schedule — "Peak",
 *  "Off-Peak", "Weekend", etc. GTFS `frequencies.txt`-shaped (a headway +
 *  a time window), not explicit per-trip stop_times: real enough to plan
 *  around, without exploding into a per-stop timetable editor. */
export interface SchedulePeriod {
  id: string;
  label: string;
  days: ScheduleDayScope;
  /** First and last departure this period covers, 24h "HH:MM". */
  spanStart: string;
  spanEnd: string;
  /** Headway in minutes — how often a vehicle departs during this period. */
  frequencyMinutes: number;
}

/** A colored route that people ride, running over one or more patterns
 *  (paths) — a plain line has exactly one; a branch has two or more. */
export interface Service {
  id: string;
  name: string;
  /** Mode catalog id: "subway" | "bus" | "tram" | "gondola" | … */
  modeId: string;
  /** Hex color, e.g. "#e4572e". */
  color: string;
  patterns: Pattern[];
  /** Peak headway in minutes — how often a vehicle departs at the busiest
   *  time of day. Undefined = not yet specified. This is the quick,
   *  always-present control (Inspector's "Peak headway" field, and what
   *  vehicle animation falls back to); `schedule` below is the optional,
   *  more detailed alternative — when present, it supersedes this pair for
   *  anything schedule-aware, and the Inspector's simple fields become a
   *  read-only summary pointing at "Edit full schedule" instead. */
  frequencyMinutes?: number;
  /** Span of service — first and last departure, 24h "HH:MM". */
  spanStart?: string;
  spanEnd?: string;
  /** Optional detailed schedule — multiple named headway periods (e.g. Peak
   *  vs. Off-Peak vs. Weekend) instead of one flat headway+span. Undefined
   *  or empty = this service just uses frequencyMinutes/spanStart/spanEnd
   *  above. See ScheduleDialog.tsx. */
  schedule?: SchedulePeriod[];
}
