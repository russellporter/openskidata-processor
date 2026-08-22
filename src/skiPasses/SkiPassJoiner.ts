import SkiAreaNameMatcher, { MatchableSkiArea } from "./SkiAreaNameMatcher";
import { SkiPassOverrideIndex } from "./SkiPassOverrides";
import {
  SkiPass,
  SkiPassMatch,
  SkiPassMembership,
  SkiPassRosterEntry,
  SkiPassSkiAreaData,
} from "./SkiPassTypes";

/** A ski area the joiner can attach ski pass data to. */
export interface JoinableSkiArea extends MatchableSkiArea {
  /** Source references in `type:id` form, used by the override file. */
  sources: string[];
}

export interface SkiPassJoinResult {
  /** Ski pass data to attach, keyed by ski area ID. Ski areas on no pass are absent. */
  skiAreaData: Map<string, SkiPassSkiAreaData>;
  passes: SkiPass[];
  matches: SkiPassMatch[];
}

function compareEntries(a: SkiPassRosterEntry, b: SkiPassRosterEntry): number {
  return (
    a.passID.localeCompare(b.passID) ||
    a.location.localeCompare(b.location) ||
    a.mountain.localeCompare(b.mountain)
  );
}

/**
 * Joins ski pass roster entries to ski areas.
 *
 * The join is deterministic: the same chart and ski areas always produce the same result, and a
 * roster entry that cannot be resolved to a ski area is reported rather than guessed at. Entries
 * that the name matcher cannot resolve have to be listed in the override file, either mapped to
 * the ski areas they cover or recorded as unmatchable; anything else fails the run.
 */
export default class SkiPassJoiner {
  constructor(
    private readonly entries: SkiPassRosterEntry[],
    private readonly overrides: SkiPassOverrideIndex,
  ) {}

  join(skiAreas: JoinableSkiArea[]): SkiPassJoinResult {
    const matcher = new SkiAreaNameMatcher(skiAreas);
    const bySource = indexBySource(skiAreas);
    const byID = new Map(skiAreas.map((skiArea) => [skiArea.id, skiArea]));

    const matches = [...this.entries]
      .sort(compareEntries)
      .map((entry) => this.matchEntry(entry, matcher, bySource));

    failOnUnresolved(matches, this.overrides.unusedOverrides(this.entries));

    return {
      skiAreaData: collectSkiAreaData(matches),
      passes: collectPasses(this.entries, matches, byID),
      matches,
    };
  }

  private matchEntry(
    entry: SkiPassRosterEntry,
    matcher: SkiAreaNameMatcher,
    bySource: Map<string, JoinableSkiArea[]>,
  ): SkiPassMatch {
    const override = this.overrides.matchFor(entry);
    if (override !== undefined) {
      const skiAreas = override.skiAreas.flatMap((source) => {
        const found = bySource.get(source);
        if (found === undefined || found.length === 0) {
          throw new Error(
            `Ski pass override for "${entry.mountain}" (${entry.location}) refers to ${source}, which is not a ski area in this data. Update src/skiPasses/overrides.json.`,
          );
        }
        return found;
      });
      return {
        entry,
        tier: "override",
        skiAreaIDs: unique(skiAreas.map((skiArea) => skiArea.id)),
        skiAreaNames: unique(skiAreas.map((skiArea) => skiArea.name)),
        candidateNames: [],
        reason: null,
      };
    }

    const exclusion = this.overrides.exclusionFor(entry);
    if (exclusion !== undefined) {
      return {
        entry,
        tier: "unmatchable",
        skiAreaIDs: [],
        skiAreaNames: [],
        candidateNames: [],
        reason: exclusion.reason,
      };
    }

    const result = matcher.match(entry);
    return {
      entry,
      tier: result.tier,
      skiAreaIDs: result.skiArea === null ? [] : [result.skiArea.id],
      skiAreaNames: result.skiArea === null ? [] : [result.skiArea.name],
      candidateNames: result.candidates.map((candidate) => candidate.name),
      reason: null,
    };
  }
}

function indexBySource(
  skiAreas: JoinableSkiArea[],
): Map<string, JoinableSkiArea[]> {
  const index = new Map<string, JoinableSkiArea[]>();
  for (const skiArea of skiAreas) {
    for (const source of skiArea.sources) {
      const existing = index.get(source);
      if (existing === undefined) {
        index.set(source, [skiArea]);
      } else {
        existing.push(skiArea);
      }
    }
  }
  return index;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function failOnUnresolved(
  matches: SkiPassMatch[],
  unusedOverrides: string[],
): void {
  const unresolved = matches.filter(
    (match) => match.tier !== "unmatchable" && match.skiAreaIDs.length === 0,
  );
  if (unresolved.length === 0) {
    if (unusedOverrides.length > 0) {
      console.warn(
        `Ski pass overrides no longer used by any roster entry:\n  ${unusedOverrides.join("\n  ")}`,
      );
    }
    return;
  }

  const details = unresolved
    .map(
      (match) =>
        `  ${match.entry.location} / ${match.entry.mountain} [${match.tier}]` +
        (match.candidateNames.length > 0
          ? ` — closest: ${match.candidateNames.slice(0, 3).join(", ")}`
          : ""),
    )
    .join("\n");
  throw new Error(
    `${unresolved.length} ski pass roster entries could not be matched to a ski area. ` +
      `Add each one to src/skiPasses/overrides.json, either mapped to the ski areas it covers or as unmatchable:\n${details}`,
  );
}

/**
 * The chart's claimed figures describe one ski area, so they are only attached when a roster
 * entry resolved to exactly one. A network entry such as the Innsbruck pass describes the network
 * as a whole, which is not a statistic about any of its ski areas.
 */
function collectSkiAreaData(
  matches: SkiPassMatch[],
): Map<string, SkiPassSkiAreaData> {
  const data = new Map<string, SkiPassSkiAreaData>();
  for (const match of matches) {
    const describesOneSkiArea = match.skiAreaIDs.length === 1;
    for (const skiAreaID of match.skiAreaIDs) {
      const existing = data.get(skiAreaID) ?? {
        skiPasses: [],
        averageSnowfallInCm: null,
        skiableAreaInSqKm: null,
      };
      existing.skiPasses.push(...match.entry.memberships);
      if (describesOneSkiArea) {
        // Several roster entries can describe the same ski area, with figures that disagree
        // slightly. The first is kept, and entries are processed in a stable order.
        existing.averageSnowfallInCm ??=
          match.entry.statistics.averageSnowfallInCm;
        existing.skiableAreaInSqKm ??= match.entry.statistics.skiableAreaInSqKm;
      }
      data.set(skiAreaID, existing);
    }
  }

  for (const skiAreaData of data.values()) {
    skiAreaData.skiPasses = uniqueMemberships(skiAreaData.skiPasses);
  }
  return data;
}

/** A ski area can be listed in several rosters of the same pass (East and West halves, say). */
function uniqueMemberships(
  memberships: SkiPassMembership[],
): SkiPassMembership[] {
  const seen = new Set<string>();
  return memberships.filter((membership) => {
    const key = `${membership.passID} ${membership.tier}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectPasses(
  entries: SkiPassRosterEntry[],
  matches: SkiPassMatch[],
  byID: Map<string, JoinableSkiArea>,
): SkiPass[] {
  const passNames = new Map<string, string>();
  for (const entry of entries) {
    passNames.set(entry.passID, entry.passName);
  }

  return [...passNames.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, name]) => {
      const passMatches = matches.filter((match) => match.entry.passID === id);
      const skiAreaIDs = unique(
        passMatches.flatMap((match) => match.skiAreaIDs),
      ).sort((a, b) =>
        (byID.get(a)?.name ?? a).localeCompare(byID.get(b)?.name ?? b),
      );
      return {
        id,
        name,
        skiAreaCount: skiAreaIDs.length,
        skiAreaIDs,
        unresolvedRosterEntries: passMatches
          .filter((match) => match.skiAreaIDs.length === 0)
          .map((match) => ({
            mountain: match.entry.mountain,
            location: match.entry.location,
            reason: match.reason ?? "no matching ski area",
          })),
      };
    });
}
