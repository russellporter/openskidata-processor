import {
  SkiPass,
  SkiPassCatalog,
  SkiPassMembership,
  Source,
} from "openskidata-format";
import uniquedSources from "../transforms/UniqueSources";
import SkiAreaNameMatcher, { MatchableSkiArea } from "./SkiAreaNameMatcher";
import { SkiPassChart } from "./SkiPassChartParser";
import { SkiPassDefinition } from "./SkiPassDefinitions";
import { SkiPassOverrideIndex } from "./SkiPassOverrides";
import {
  SkiPassMatch,
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
  catalog: SkiPassCatalog;
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
 * the ski areas they cover or recorded as unmatchable; anything else fails a run over every ski
 * area.
 */
export default class SkiPassJoiner {
  /**
   * `coversEverySkiArea` is false when the ski areas are a geographic extract rather than the
   * whole world, which is the only case where an unresolved roster entry is not an error.
   */
  constructor(
    private readonly chart: SkiPassChart,
    private readonly overrides: SkiPassOverrideIndex,
    private readonly coversEverySkiArea: boolean = true,
  ) {}

  join(skiAreas: JoinableSkiArea[]): SkiPassJoinResult {
    const entries = this.chart.entries;
    const matcher = new SkiAreaNameMatcher(skiAreas);
    const bySource = indexBySource(skiAreas);

    const matches = [...entries]
      .sort(compareEntries)
      .map((entry) => this.matchEntry(entry, matcher, bySource));

    reportUnresolved(
      matches,
      this.overrides.unusedOverrides(entries),
      this.coversEverySkiArea,
    );

    return {
      skiAreaData: collectSkiAreaData(matches),
      catalog: {
        brands: this.chart.brands,
        passes: collectPasses(
          this.chart.passes,
          matches,
          this.chart.sourcesByPassID,
        ),
      },
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
          // On a geographic extract the ski area is simply outside it, which is not an error.
          if (!this.coversEverySkiArea) {
            return [];
          }
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

function reportUnresolved(
  matches: SkiPassMatch[],
  unusedOverrides: string[],
  coversEverySkiArea: boolean,
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

  if (!coversEverySkiArea) {
    // The ski areas are a geographic extract, so an entry outside it is indistinguishable from
    // one with no ski area at all. Only a run over every ski area can tell the difference.
    console.warn(
      `${unresolved.length} ski pass roster entries have no ski area in this extract:\n${details}`,
    );
    return;
  }

  throw new Error(
    `${unresolved.length} ski pass roster entries could not be matched to a ski area. ` +
      `Add each one to src/skiPasses/overrides.json, either mapped to the ski areas it covers or as unmatchable:\n${details}`,
  );
}

function collectSkiAreaData(
  matches: SkiPassMatch[],
): Map<string, SkiPassSkiAreaData> {
  const data = new Map<string, SkiPassSkiAreaData>();
  for (const match of matches) {
    for (const skiAreaID of match.skiAreaIDs) {
      const existing = data.get(skiAreaID) ?? { skiPasses: [] };
      existing.skiPasses.push(...match.entry.memberships);
      data.set(skiAreaID, existing);
    }
  }

  for (const skiAreaData of data.values()) {
    skiAreaData.skiPasses = uniqueMemberships(skiAreaData.skiPasses);
  }
  return data;
}

/**
 * A ski area can be listed in several rosters of the same pass (East and West halves, say), or
 * be covered by several roster entries. Each listing is a source for the same membership.
 */
function uniqueMemberships(
  memberships: SkiPassMembership[],
): SkiPassMembership[] {
  const merged = new Map<string, SkiPassMembership>();
  for (const membership of memberships) {
    const key = membership.passID;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...membership });
      continue;
    }
    existing.sources = uniquedSources([
      ...existing.sources,
      ...membership.sources,
    ]);
  }
  return [...merged.values()];
}

function collectPasses(
  definitions: SkiPassDefinition[],
  matches: SkiPassMatch[],
  sourcesByPassID: Map<string, Source[]>,
): SkiPass[] {
  return [...definitions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((definition) => {
      const passMatches = matches.filter(
        (match) => match.entry.passID === definition.id,
      );
      const skiAreaIDs = unique(
        passMatches.flatMap((match) => match.skiAreaIDs),
      ).sort();
      return {
        type: "skiPass" as const,
        id: definition.id,
        name: definition.name,
        brandID: definition.brandID,
        brandName: definition.brandName,
        sources: sourcesByPassID.get(definition.id) ?? [],
        skiAreaCount: skiAreaIDs.length,
        skiAreaIDs,
        unresolvedRosterEntries: passMatches
          .filter((match) => match.skiAreaIDs.length === 0)
          .map((match) => ({
            name: match.entry.mountain,
            location: match.entry.location,
            reason: match.reason ?? "no matching ski area",
          })),
      };
    });
}
