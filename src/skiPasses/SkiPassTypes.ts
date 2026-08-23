/**
 * Types used while parsing the ski pass chart and joining it to ski areas. The entities the
 * pipeline outputs — `SkiPass` and `SkiPassMembership` — come from `openskidata-format`.
 */

import { SkiPassID, SkiPassMembership } from "openskidata-format";

/** Everything the joiner attaches to a single ski area. */
export interface SkiPassSkiAreaData {
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
