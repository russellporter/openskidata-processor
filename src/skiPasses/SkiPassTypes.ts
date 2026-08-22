/**
 * Types for ski pass (multi-resort season pass) data.
 *
 * These mirror the types that will be added to `openskidata-format`. Once that package is
 * released with `skiPasses`, `averageSnowfallInCm` and `skiableAreaInSqKm` on
 * `SkiAreaProperties`, these local definitions can be replaced by imports.
 */

/** Stable identifier for a ski pass, e.g. "ikon". Declared in SkiPassDefinitions. */
export type SkiPassID = string;

/** A ski area's membership of one tier of one ski pass. */
export interface SkiPassMembership {
  passID: SkiPassID;
  passName: string;
  /** Tier within the pass, e.g. "base" or "session". Null for the pass's standard tier. */
  tier: string | null;
  /**
   * Access code, copied verbatim from the chart, e.g. "5, 26, 27" or "U".
   * The chart documents these per-roster in free text, so they are not parsed.
   */
  access: string | null;
  yearJoined: number | null;
}

/** Claimed resort figures from the ski pass chart, converted to metric. */
export interface SkiPassChartStatistics {
  averageSnowfallInCm: number | null;
  skiableAreaInSqKm: number | null;
}

/** Everything the joiner attaches to a single ski area. */
export interface SkiPassSkiAreaData extends SkiPassChartStatistics {
  skiPasses: SkiPassMembership[];
}

/** One row of one roster block in the ski pass chart. */
export interface SkiPassRosterEntry {
  passID: SkiPassID;
  passName: string;
  /** Location string as written in the chart, e.g. "U.S. - Colorado". */
  location: string;
  /** Ski area name as written in the chart. */
  mountain: string;
  memberships: SkiPassMembership[];
  statistics: SkiPassChartStatistics;
  /** Base elevation in meters, used only as a tie-breaker when matching. */
  baseElevationInMeters: number | null;
  /** Summit elevation in meters, used only as a tie-breaker when matching. */
  summitElevationInMeters: number | null;
}

/** How a roster entry was resolved to ski areas. */
export type SkiPassMatchTier =
  | "exact"
  | "core"
  | "squash"
  | "subset"
  | "fuzzy"
  | "override"
  | "unmatchable"
  | "ambiguous"
  | "none";

export interface SkiPassMatch {
  entry: SkiPassRosterEntry;
  tier: SkiPassMatchTier;
  /** Ski area feature IDs this roster entry resolved to. Empty when unresolved. */
  skiAreaIDs: string[];
  /** Ski area names, parallel to skiAreaIDs. For reporting and the CSV export. */
  skiAreaNames: string[];
  /** Populated when the entry could not be resolved: the candidates considered, if any. */
  candidateNames: string[];
  /** Populated for `unmatchable` entries. */
  reason: string | null;
}

/** Aggregated view of one ski pass, for the ski pass entity output. */
export interface SkiPass {
  id: SkiPassID;
  name: string;
  skiAreaCount: number;
  skiAreaIDs: string[];
  /** Roster entries that could not be resolved to a ski area, with the reason. */
  unresolvedRosterEntries: {
    mountain: string;
    location: string;
    reason: string;
  }[];
}
