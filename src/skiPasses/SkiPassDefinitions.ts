import { SkiPassID } from "openskidata-format";

/**
 * Column in a roster block that records access to a tier of the block's ski pass.
 */
interface TierColumn {
  /** Column header as written in the chart. */
  header: string;
  /** Tier identifier, or null for the pass's standard tier. */
  tier: string | null;
}

export interface SkiPassDefinition {
  id: SkiPassID;
  name: string;
  /**
   * Titles of the chart's roster blocks that belong to this pass. Membership is derived from
   * which block a row appears in, never from the cross-reference columns that some blocks carry
   * for other passes (those are fully redundant with the other pass's own block).
   */
  chartBlockTitles: string[];
  /**
   * Columns within this pass's blocks that record per-tier access. A row produces one membership
   * per populated tier column, or a single membership with a null tier if none are populated.
   */
  tierColumns: TierColumn[];
  /** Column recording the year the ski area joined this pass, if the chart has one. */
  yearJoinedColumn: string | null;
}

export const skiPassDefinitions: SkiPassDefinition[] = [
  {
    id: "indy",
    name: "Indy Pass",
    chartBlockTitles: ["INDY PASS ROSTER"],
    tierColumns: [
      { header: "Indy", tier: null },
      { header: "Indy+", tier: "plus" },
      { header: "Indy Learn-To-Turn", tier: "learn-to-turn" },
    ],
    yearJoinedColumn: "YEAR JOINED INDY",
  },
  {
    id: "ikon",
    name: "Ikon Pass",
    chartBlockTitles: ["IKON PASS ROSTER"],
    tierColumns: [
      { header: "Ikon", tier: null },
      { header: "Ikon Base", tier: "base" },
      { header: "Ikon Session", tier: "session" },
    ],
    yearJoinedColumn: "YEAR JOINED IKON",
  },
  {
    id: "ikon-2-day",
    name: "Ikon Pass 2-Day",
    chartBlockTitles: ["IKON PASS 2-DAY ROSTER"],
    tierColumns: [{ header: "Ikon", tier: null }],
    yearJoinedColumn: "YEAR JOINED IKON",
  },
  {
    id: "ikon-midwest",
    name: "Ikon Pass Midwest",
    chartBlockTitles: ["IKON PASS MIDWEST ROSTER"],
    tierColumns: [],
    yearJoinedColumn: null,
  },
  {
    id: "epic",
    name: "Epic Pass",
    chartBlockTitles: ["EPIC PASS ROSTER"],
    tierColumns: [
      { header: "Epic", tier: null },
      { header: "Epic Local", tier: "local" },
      { header: "Epic Northeast Value", tier: "northeast-value" },
      { header: "Epic Northeast Midweek", tier: "northeast-midweek" },
      { header: "Epic Tahoe Local", tier: "tahoe-local" },
      { header: "Epic Tahoe Value", tier: "tahoe-value" },
      { header: "Epic Keystone Plus", tier: "keystone-plus" },
      { header: "Epic Summit Value", tier: "summit-value" },
      { header: "Epic Ohio", tier: "ohio" },
      { header: "Epic Day All", tier: "day-all" },
      { header: "Epic Day 32", tier: "day-32" },
      { header: "Epic Day 22", tier: "day-22" },
      { header: "Epic Military", tier: "military" },
    ],
    yearJoinedColumn: "Year Joined Pass",
  },
  {
    id: "mountain-collective",
    name: "Mountain Collective",
    chartBlockTitles: [
      "MOUNTAIN COLLECTIVE ROSTER",
      "MOUNTAIN COLLECTIVE PARTNERS THAT ARE NOT ON IKON",
    ],
    tierColumns: [{ header: "Mountain Collective", tier: null }],
    yearJoinedColumn: "YEAR JOINED MC",
  },
  {
    id: "snow-triple-play-east",
    name: "Snow Triple Play East",
    chartBlockTitles: [
      "SNOW TRIPLE PLAY EAST ROSTER",
      "SNOW PASS + SNOW TRIPLE PLAY ROSTER",
    ],
    tierColumns: [{ header: "Snow Triple Play East", tier: null }],
    // Only the combined roster has this column; the pass's own roster records no join year.
    yearJoinedColumn: "Year Joined Snow Triple Play",
  },
  {
    id: "snow-pass",
    name: "Snow Pass",
    chartBlockTitles: [
      "SNOW PASS ROSTER",
      "SNOW PASS + SNOW TRIPLE PLAY ROSTER",
    ],
    tierColumns: [{ header: "Snow Pass", tier: null }],
    yearJoinedColumn: "Year Joined Snow Pass",
  },
  {
    id: "power",
    name: "Power Pass",
    chartBlockTitles: ["POWER PASS ROSTER"],
    tierColumns: [
      { header: "Power", tier: null },
      { header: "Power Pass Select", tier: "select" },
      { header: "Power Pass Core", tier: "core" },
    ],
    yearJoinedColumn: null,
  },
  {
    id: "powder-alliance",
    name: "Powder Alliance",
    chartBlockTitles: ["POWDER ALLIANCE ROSTER"],
    tierColumns: [{ header: "Powder Alliance", tier: null }],
    yearJoinedColumn: "YEAR JOINED POWDER ALLIANCE",
  },
  {
    id: "new-england",
    name: "New England Pass",
    chartBlockTitles: ["NEW ENGLAND PASS ROSTER"],
    tierColumns: [
      { header: "New England Gold Pass", tier: "gold" },
      { header: "New England Silver Pass", tier: "silver" },
      { header: "New England Bronze Pass", tier: "bronze" },
      { header: "New England Nitro Unlimited", tier: "nitro-unlimited" },
      { header: "New England Nitro Limited", tier: "nitro-limited" },
      { header: "New England College", tier: "college" },
      { header: "New England College Limited", tier: "college-limited" },
      { header: "New England Afternoon", tier: "afternoon" },
      {
        header: "New England Super Senior & Child",
        tier: "super-senior-child",
      },
      { header: "New England Day", tier: "day" },
    ],
    yearJoinedColumn: null,
  },
];

const definitionsByBlockTitle = skiPassDefinitions.reduce(
  (index, definition) => {
    for (const title of definition.chartBlockTitles) {
      const key = normalizeBlockTitle(title);
      index.set(key, [...(index.get(key) ?? []), definition]);
    }
    return index;
  },
  new Map<string, SkiPassDefinition[]>(),
);

export function normalizeBlockTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Resolves a roster block title to the ski passes it lists. Usually one, but the chart has a
 * combined roster of the ski areas that are on both the Snow Pass and Snow Triple Play East.
 *
 * Throws for an unrecognized block, so that a new or renamed roster in the chart fails the run
 * rather than being silently dropped.
 */
export function skiPassesForBlockTitle(title: string): SkiPassDefinition[] {
  const definitions = definitionsByBlockTitle.get(normalizeBlockTitle(title));
  if (definitions === undefined) {
    throw new Error(
      `Unknown ski pass roster block "${title}". Add it to skiPassDefinitions or remove it from the chart.`,
    );
  }
  return definitions;
}
