import type { Grade } from "./catalog";
import { wayLengthMeters } from "./geo";
import type { Way } from "./system";

export interface CapitalCostEstimate {
  perMileLowUsd: number;
  perMileHighUsd: number;
  totalLowUsd: number;
  totalHighUsd: number;
}

const METERS_PER_MILE = 1609.344;

interface PerMileRange {
  lowUsd: number;
  highUsd: number;
}

// Rough order-of-magnitude US capital-cost benchmarks, $/route-mile, bucketed
// by way type + grade — the general bucket a real project would land in per
// FTA's Capital Costs Database and the Transit Costs Project's cross-project
// comparisons, NOT a substitute for a real feasibility study. Real projects
// vary by an order of magnitude on local factors (utility relocation, land
// acquisition, labor market) this tool has no way to know, so the honest
// output is a wide, clearly-labeled range, never a fake-precise number.
// Water is deliberately absent: a ferry's cost is dominated by vessels and
// terminals, not linear right-of-way, so a $/mile figure would mislead more
// than it'd inform. Aerial (gondola) only has an "elevated" entry — that's
// the only grade a cableway is actually built in.
const COST_TABLE: Partial<Record<string, Partial<Record<Grade, PerMileRange>>>> = {
  heavyRail: {
    underground: { lowUsd: 500_000_000, highUsd: 1_500_000_000 },
    atGrade: { lowUsd: 100_000_000, highUsd: 300_000_000 },
    elevated: { lowUsd: 200_000_000, highUsd: 500_000_000 },
  },
  lightRail: {
    underground: { lowUsd: 300_000_000, highUsd: 600_000_000 },
    atGrade: { lowUsd: 50_000_000, highUsd: 150_000_000 },
    elevated: { lowUsd: 150_000_000, highUsd: 300_000_000 },
  },
  monorail: {
    underground: { lowUsd: 300_000_000, highUsd: 600_000_000 },
    atGrade: { lowUsd: 80_000_000, highUsd: 200_000_000 },
    elevated: { lowUsd: 100_000_000, highUsd: 300_000_000 },
  },
  road: {
    underground: { lowUsd: 200_000_000, highUsd: 500_000_000 },
    atGrade: { lowUsd: 5_000_000, highUsd: 20_000_000 },
    elevated: { lowUsd: 50_000_000, highUsd: 150_000_000 },
  },
  bike: {
    underground: { lowUsd: 20_000_000, highUsd: 50_000_000 },
    atGrade: { lowUsd: 500_000, highUsd: 3_000_000 },
    elevated: { lowUsd: 5_000_000, highUsd: 15_000_000 },
  },
  aerial: {
    elevated: { lowUsd: 10_000_000, highUsd: 30_000_000 },
  },
};

/** null when the way's type/grade combination has no meaningful $/mile
 *  concept (a ferry route, an at-grade gondola) — silence is more honest
 *  than a number that doesn't mean anything. */
export function estimateWayCapitalCost(way: Way): CapitalCostEstimate | null {
  const range = COST_TABLE[way.typeId]?.[way.grade];
  if (!range) return null;
  const miles = wayLengthMeters(way) / METERS_PER_MILE;
  return {
    perMileLowUsd: range.lowUsd,
    perMileHighUsd: range.highUsd,
    totalLowUsd: range.lowUsd * miles,
    totalHighUsd: range.highUsd * miles,
  };
}

/** "$1.2M" / "$340M" / "$1.1B" — compact enough for an inspector stat. */
export function formatUsdCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}
