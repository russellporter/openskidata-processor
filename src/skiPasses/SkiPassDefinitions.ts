import { SkiPassBrandID, SkiPassID } from "openskidata-format";

export interface SkiPassBrandDefinition {
  id: SkiPassBrandID;
  name: string;
}

export interface SkiPassDefinition {
  id: SkiPassID;
  name: string;
  brandID: SkiPassBrandID | null;
  brandName: string | null;
  chartBlockTitles: string[];
  /** Access column for this pass, or null when appearing in its roster is membership itself. */
  accessColumn: string | null;
  yearJoinedColumn: string | null;
}

export const skiPassBrandDefinitions: SkiPassBrandDefinition[] = [
  { id: "indy", name: "Indy Pass" },
  { id: "ikon", name: "Ikon Pass" },
  { id: "epic", name: "Epic Pass" },
  { id: "power", name: "Power Pass" },
  { id: "new-england", name: "New England Pass" },
];

const brandsByID = new Map(
  skiPassBrandDefinitions.map((brand) => [brand.id, brand]),
);

function pass(
  id: SkiPassID,
  name: string,
  brandID: SkiPassBrandID | null,
  chartBlockTitles: string[],
  accessColumn: string | null,
  yearJoinedColumn: string | null,
): SkiPassDefinition {
  return {
    id,
    name,
    brandID,
    brandName: brandID === null ? null : brandsByID.get(brandID)!.name,
    chartBlockTitles,
    accessColumn,
    yearJoinedColumn,
  };
}

const INDY_BLOCKS = ["INDY PASS ROSTER"];
const IKON_BLOCKS = ["IKON PASS ROSTER"];
const EPIC_BLOCKS = ["EPIC PASS ROSTER"];
const POWER_BLOCKS = ["POWER PASS ROSTER"];
const NEW_ENGLAND_BLOCKS = ["NEW ENGLAND PASS ROSTER"];

/** Stable definitions turn chart columns into first-class purchasable passes. */
export const skiPassDefinitions: SkiPassDefinition[] = [
  pass(
    "indy-standard",
    "Indy",
    "indy",
    INDY_BLOCKS,
    "Indy",
    "YEAR JOINED INDY",
  ),
  pass("indy-plus", "Indy+", "indy", INDY_BLOCKS, "Indy+", "YEAR JOINED INDY"),
  pass(
    "indy-learn-to-turn",
    "Indy Learn-To-Turn",
    "indy",
    INDY_BLOCKS,
    "Indy Learn-To-Turn",
    "YEAR JOINED INDY",
  ),
  pass(
    "ikon-standard",
    "Ikon",
    "ikon",
    IKON_BLOCKS,
    "Ikon",
    "YEAR JOINED IKON",
  ),
  pass(
    "ikon-base",
    "Ikon Base",
    "ikon",
    IKON_BLOCKS,
    "Ikon Base",
    "YEAR JOINED IKON",
  ),
  pass(
    "ikon-session",
    "Ikon Session",
    "ikon",
    IKON_BLOCKS,
    "Ikon Session",
    "YEAR JOINED IKON",
  ),
  pass(
    "ikon-2-day",
    "Ikon Pass 2-Day",
    "ikon",
    ["IKON PASS 2-DAY ROSTER"],
    "Ikon",
    "YEAR JOINED IKON",
  ),
  pass(
    "ikon-midwest",
    "Ikon Pass Midwest",
    "ikon",
    ["IKON PASS MIDWEST ROSTER"],
    null,
    null,
  ),
  pass(
    "epic-standard",
    "Epic",
    "epic",
    EPIC_BLOCKS,
    "Epic",
    "Year Joined Pass",
  ),
  pass(
    "epic-local",
    "Epic Local",
    "epic",
    EPIC_BLOCKS,
    "Epic Local",
    "Year Joined Pass",
  ),
  pass(
    "epic-northeast-value",
    "Epic Northeast Value",
    "epic",
    EPIC_BLOCKS,
    "Epic Northeast Value",
    "Year Joined Pass",
  ),
  pass(
    "epic-northeast-midweek",
    "Epic Northeast Midweek",
    "epic",
    EPIC_BLOCKS,
    "Epic Northeast Midweek",
    "Year Joined Pass",
  ),
  pass(
    "epic-tahoe-local",
    "Epic Tahoe Local",
    "epic",
    EPIC_BLOCKS,
    "Epic Tahoe Local",
    "Year Joined Pass",
  ),
  pass(
    "epic-tahoe-value",
    "Epic Tahoe Value",
    "epic",
    EPIC_BLOCKS,
    "Epic Tahoe Value",
    "Year Joined Pass",
  ),
  pass(
    "epic-keystone-plus",
    "Epic Keystone Plus",
    "epic",
    EPIC_BLOCKS,
    "Epic Keystone Plus",
    "Year Joined Pass",
  ),
  pass(
    "epic-summit-value",
    "Epic Summit Value",
    "epic",
    EPIC_BLOCKS,
    "Epic Summit Value",
    "Year Joined Pass",
  ),
  pass(
    "epic-ohio",
    "Epic Ohio",
    "epic",
    EPIC_BLOCKS,
    "Epic Ohio",
    "Year Joined Pass",
  ),
  pass(
    "epic-day-all",
    "Epic Day All",
    "epic",
    EPIC_BLOCKS,
    "Epic Day All",
    "Year Joined Pass",
  ),
  pass(
    "epic-day-32",
    "Epic Day 32",
    "epic",
    EPIC_BLOCKS,
    "Epic Day 32",
    "Year Joined Pass",
  ),
  pass(
    "epic-day-22",
    "Epic Day 22",
    "epic",
    EPIC_BLOCKS,
    "Epic Day 22",
    "Year Joined Pass",
  ),
  pass(
    "epic-military",
    "Epic Military",
    "epic",
    EPIC_BLOCKS,
    "Epic Military",
    "Year Joined Pass",
  ),
  pass(
    "mountain-collective",
    "Mountain Collective",
    null,
    [
      "MOUNTAIN COLLECTIVE ROSTER",
      "MOUNTAIN COLLECTIVE PARTNERS THAT ARE NOT ON IKON",
    ],
    "Mountain Collective",
    "YEAR JOINED MC",
  ),
  pass(
    "snow-triple-play-east",
    "Snow Triple Play East",
    null,
    ["SNOW TRIPLE PLAY EAST ROSTER", "SNOW PASS + SNOW TRIPLE PLAY ROSTER"],
    "Snow Triple Play East",
    "Year Joined Snow Triple Play",
  ),
  pass(
    "snow-pass",
    "Snow Pass",
    null,
    ["SNOW PASS ROSTER", "SNOW PASS + SNOW TRIPLE PLAY ROSTER"],
    "Snow Pass",
    "Year Joined Snow Pass",
  ),
  pass("power-standard", "Power", "power", POWER_BLOCKS, "Power", null),
  pass(
    "power-select",
    "Power Pass Select",
    "power",
    POWER_BLOCKS,
    "Power Pass Select",
    null,
  ),
  pass(
    "power-core",
    "Power Pass Core",
    "power",
    POWER_BLOCKS,
    "Power Pass Core",
    null,
  ),
  pass(
    "powder-alliance",
    "Powder Alliance",
    null,
    ["POWDER ALLIANCE ROSTER"],
    "Powder Alliance",
    "YEAR JOINED POWDER ALLIANCE",
  ),
  ...[
    ["gold", "New England Gold Pass"],
    ["silver", "New England Silver Pass"],
    ["bronze", "New England Bronze Pass"],
    ["nitro-unlimited", "New England Nitro Unlimited"],
    ["nitro-limited", "New England Nitro Limited"],
    ["college", "New England College"],
    ["college-limited", "New England College Limited"],
    ["afternoon", "New England Afternoon"],
    ["super-senior-child", "New England Super Senior & Child"],
    ["day", "New England Day"],
  ].map(([id, name]) =>
    pass(
      `new-england-${id}`,
      name,
      "new-england",
      NEW_ENGLAND_BLOCKS,
      name,
      null,
    ),
  ),
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

/** Resolve a roster block to every actual pass whose membership it can describe. */
export function skiPassesForBlockTitle(title: string): SkiPassDefinition[] {
  const definitions = definitionsByBlockTitle.get(normalizeBlockTitle(title));
  if (definitions === undefined) {
    throw new Error(
      `Unknown ski pass roster block "${title}". Add it to skiPassDefinitions or remove it from the chart.`,
    );
  }
  return definitions;
}
