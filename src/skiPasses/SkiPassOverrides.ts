import { readFileSync } from "fs";
import { SkiPassRosterEntry } from "./SkiPassTypes.js";

/**
 * A roster entry mapped by hand to the ski areas it covers.
 *
 * Ski areas are referenced by source ID (`skimap.org:1075`, `openstreetmap:relation/123`) rather
 * than by ski area ID: a ski area's ID is a hash of the feature, so it changes whenever anything
 * about the ski area changes, while source IDs are stable.
 */
export interface SkiPassOverrideMatch {
  location: string;
  mountain: string;
  /**
   * One or more `type:id` source references. More than one is the normal case for a roster entry
   * covering a network of ski areas, such as the Innsbruck Ski Plus City pass.
   */
  skiAreas: string[];
  note?: string;
}

/** A roster entry with no ski area in the data to map it to. */
export interface SkiPassOverrideExclusion {
  location: string;
  mountain: string;
  reason: string;
}

export interface SkiPassOverrides {
  matches: SkiPassOverrideMatch[];
  unmatchable: SkiPassOverrideExclusion[];
}

function overrideKey(entry: { location: string; mountain: string }): string {
  return `${entry.location}\0${entry.mountain}`;
}

export class SkiPassOverrideIndex {
  private readonly matches = new Map<string, SkiPassOverrideMatch>();
  private readonly unmatchable = new Map<string, SkiPassOverrideExclusion>();

  constructor(overrides: SkiPassOverrides) {
    for (const match of overrides.matches) {
      if (match.skiAreas.length === 0) {
        throw new Error(
          `Ski pass override for "${match.mountain}" lists no ski areas. Move it to "unmatchable" if it has none.`,
        );
      }
      this.matches.set(overrideKey(match), match);
    }
    for (const exclusion of overrides.unmatchable) {
      const key = overrideKey(exclusion);
      if (this.matches.has(key)) {
        throw new Error(
          `Ski pass override for "${exclusion.mountain}" is listed as both matched and unmatchable.`,
        );
      }
      this.unmatchable.set(key, exclusion);
    }
  }

  matchFor(entry: SkiPassRosterEntry): SkiPassOverrideMatch | undefined {
    return this.matches.get(overrideKey(entry));
  }

  exclusionFor(
    entry: SkiPassRosterEntry,
  ): SkiPassOverrideExclusion | undefined {
    return this.unmatchable.get(overrideKey(entry));
  }

  /** Overrides that no roster entry used, so that stale entries can be reported. */
  unusedOverrides(entries: SkiPassRosterEntry[]): string[] {
    const used = new Set(entries.map(overrideKey));
    return [...this.matches.values(), ...this.unmatchable.values()]
      .filter((override) => !used.has(overrideKey(override)))
      .map((override) => `${override.location} / ${override.mountain}`);
  }
}

export function loadSkiPassOverrides(path: string): SkiPassOverrideIndex {
  const parsed = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<SkiPassOverrides>;
  return new SkiPassOverrideIndex({
    matches: parsed.matches ?? [],
    unmatchable: parsed.unmatchable ?? [],
  });
}
