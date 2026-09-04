import { parse } from "csv-parse/sync";
import {
  SkiPassBrand,
  SkiPassID,
  SkiPassMembership,
  Source,
} from "openskidata-format";
import { skiPassChartSource } from "./SkiPassCellReference";
import {
  SkiPassDefinition,
  skiPassBrandDefinitions,
  skiPassesForBlockTitle,
} from "./SkiPassDefinitions";
import { SkiPassRosterEntry } from "./SkiPassTypes";
import uniquedSources from "../transforms/UniqueSources";

const METERS_PER_FOOT = 0.3048;

/** The chart's title row, which holds each roster block's title. */
const TITLE_ROW = 0;

// A chart with fewer blocks or rows than this has almost certainly changed shape rather than
// legitimately shrunk, so parsing fails instead of silently dropping most of the rosters.
const MINIMUM_ROSTER_BLOCKS = 8;
const MINIMUM_ROSTER_ENTRIES = 400;

// The header row is found by structure rather than by a fixed index, since the chart's preamble
// rows change. It is the first row containing several "Location" / ski area name header pairs.
// The pair matters: the chart's preamble also has a row of "LOCATION" section labels.
const MINIMUM_ROSTER_HEADER_PAIRS = 3;
const MAXIMUM_HEADER_ROW_INDEX = 20;

type Grid = string[][];

function cell(grid: Grid, row: number, column: number): string {
  const values = grid[row];
  if (values === undefined) {
    return "";
  }
  return values[column] ?? "";
}

/** Collapses the line breaks the chart uses inside header cells, and lowercases. */
function headerKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function columnCount(grid: Grid): number {
  return grid.reduce((max, row) => Math.max(max, row.length), 0);
}

/** Columns where a "Location" header is followed by the roster's ski area name header. */
function findRosterHeaderColumns(grid: Grid, row: number): number[] {
  const columns: number[] = [];
  for (let column = 0; column < columnCount(grid); column++) {
    const isLocation = headerKey(cell(grid, row, column)) === "location";
    const nameHeader = headerKey(cell(grid, row, column + 1));
    if (
      isLocation &&
      (nameHeader === "mountain" || nameHeader === "ski area")
    ) {
      columns.push(column);
    }
  }
  return columns;
}

function findHeaderRow(grid: Grid): number {
  const limit = Math.min(grid.length, MAXIMUM_HEADER_ROW_INDEX);
  for (let row = 0; row < limit; row++) {
    if (
      findRosterHeaderColumns(grid, row).length >= MINIMUM_ROSTER_HEADER_PAIRS
    ) {
      return row;
    }
  }
  throw new Error(
    "Could not find the ski pass chart header row: no row has several 'Location' / ski area name header pairs.",
  );
}

interface RosterBlock {
  pass: SkiPassDefinition;
  /** Column of the block's "Location" header. The name column is the next one. */
  startColumn: number;
  /** Column after the last one belonging to this block. */
  endColumn: number;
  /** The cell holding this block's title, which is the pass's source in the chart. */
  titleSource: Source;
}

/**
 * One block per (roster block, ski pass) pair. A block usually lists a single pass, but the
 * chart has a combined roster listing two, and each pass reads its own columns from it.
 */
function findRosterBlocks(
  grid: Grid,
  headerRow: number,
  gid: string,
): RosterBlock[] {
  const totalColumns = columnCount(grid);
  const startColumns = findRosterHeaderColumns(grid, headerRow);

  return startColumns.flatMap((startColumn, index) => {
    const endColumn = startColumns[index + 1] ?? totalColumns;
    const title = findBlockTitle(grid, startColumn, endColumn);
    const titleSource = skiPassChartSource(gid, TITLE_ROW, title.column);
    return skiPassesForBlockTitle(title.value).map((pass) => ({
      pass,
      startColumn,
      endColumn,
      titleSource,
    }));
  });
}

/**
 * The roster title is the first non-empty cell of the chart's title row within the block's
 * columns. Blocks lay their title above their own columns, though not always above the first one.
 */
function findBlockTitle(
  grid: Grid,
  startColumn: number,
  endColumn: number,
): { value: string; column: number } {
  for (let column = startColumn; column < endColumn; column++) {
    const value = cell(grid, TITLE_ROW, column).trim();
    if (value.length > 0) {
      return { value, column };
    }
  }
  throw new Error(
    `Ski pass chart roster block at column ${startColumn} has no title.`,
  );
}

function parseNumber(value: string): number | null {
  // Values carry thousands separators, trailing units and the occasional soft hyphen.
  const digits = value.replace(/[^0-9.]/g, "");
  if (digits.length === 0) {
    return null;
  }
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Converts and rounds, so unit conversion does not leave floating point noise in the output. */
function convert(
  value: string,
  factor: number,
  decimals: number,
): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  const scale = 10 ** decimals;
  return Math.round(parsed * factor * scale) / scale;
}

interface BlockColumns {
  name: number;
  base: number | null;
  summit: number | null;
  yearJoined: number | null;
  access: number | null;
}

function resolveColumns(
  grid: Grid,
  headerRow: number,
  block: RosterBlock,
): BlockColumns {
  const columns: BlockColumns = {
    name: block.startColumn + 1,
    base: null,
    summit: null,
    yearJoined: null,
    access: null,
  };

  const yearJoinedKey =
    block.pass.yearJoinedColumn === null
      ? null
      : headerKey(block.pass.yearJoinedColumn);

  for (let column = block.startColumn + 2; column < block.endColumn; column++) {
    const key = headerKey(cell(grid, headerRow, column));
    if (key.length === 0) {
      continue;
    }

    // Elevation headers are matched loosely: they wrap across several lines in the chart, so
    // their exact spacing is not something to depend on. Not every block has them.
    if (columns.base === null && key.startsWith("base")) {
      columns.base = column;
    } else if (columns.summit === null && key.startsWith("summit")) {
      columns.summit = column;
    }

    if (yearJoinedKey !== null && key === yearJoinedKey) {
      columns.yearJoined = column;
    }

    if (
      block.pass.accessColumn !== null &&
      headerKey(block.pass.accessColumn) === key
    ) {
      columns.access = column;
    }
  }

  if (block.pass.accessColumn !== null && columns.access === null) {
    throw new Error(
      `Ski pass chart roster "${block.pass.name}" has no "${block.pass.accessColumn}" access column.`,
    );
  }

  return columns;
}

function readMemberships(
  grid: Grid,
  row: number,
  block: RosterBlock,
  columns: BlockColumns,
  gid: string,
): SkiPassMembership[] {
  const yearJoined =
    columns.yearJoined === null
      ? null
      : parseNumber(cell(grid, row, columns.yearJoined));

  // The ski area's name cell is the row's most useful landing point in the chart.
  const sources = [skiPassChartSource(gid, row, columns.name)];

  const access =
    columns.access === null
      ? null
      : cell(grid, row, columns.access).replace(/\s+/g, " ").trim();

  // In a multi-product roster, an empty product column means the ski area is not on that pass.
  if (access !== null && access.length === 0) {
    return [];
  }

  return [
    {
      passID: block.pass.id,
      passName: block.pass.name,
      brandID: block.pass.brandID,
      brandName: block.pass.brandName,
      access,
      yearJoined,
      sources,
    },
  ];
}

/**
 * A ski area can appear in more than one of a pass's roster blocks (the Mountain Collective
 * roster and its "partners not on Ikon" annex overlap), which repeats its memberships.
 */
function uniqueMemberships(
  memberships: SkiPassMembership[],
): SkiPassMembership[] {
  const merged = new Map<string, SkiPassMembership>();
  for (const membership of memberships) {
    const key = membership.passID;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, membership);
      continue;
    }
    // The rows describe the same membership, so keep both cells as its sources.
    existing.sources = uniquedSources([
      ...existing.sources,
      ...membership.sources,
    ]);
  }
  return [...merged.values()];
}

export interface SkiPassChart {
  entries: SkiPassRosterEntry[];
  /** Actual pass definitions encountered in the chart. */
  passes: SkiPassDefinition[];
  /** Visual groupings of related passes. */
  brands: SkiPassBrand[];
  /** The chart's roster block title cells, per ski pass. */
  sourcesByPassID: Map<SkiPassID, Source[]>;
}

/**
 * Parses the ski pass chart CSV into one entry per (ski pass, ski area) pair.
 *
 * The chart is a wide spreadsheet holding each pass's roster as a block of columns laid out side
 * by side. Blocks are located structurally, by their "Location" / "Mountain" header pair, so that
 * a block being added, removed or moved does not shift the others.
 *
 * `gid` identifies the sheet within the chart's spreadsheet, so that every value read can be
 * traced back to the cell it came from.
 */
export function parseSkiPassChart(contents: string, gid: string): SkiPassChart {
  const grid = parse(contents, {
    relaxColumnCount: true,
    skipEmptyLines: false,
  }) as Grid;

  if (grid.length === 0) {
    throw new Error("Ski pass chart is empty.");
  }

  const headerRow = findHeaderRow(grid);
  const blocks = findRosterBlocks(grid, headerRow, gid);
  const blockCount = new Set(blocks.map((block) => block.startColumn)).size;
  if (blockCount < MINIMUM_ROSTER_BLOCKS) {
    throw new Error(
      `Ski pass chart has only ${blockCount} roster blocks, expected at least ${MINIMUM_ROSTER_BLOCKS}. The chart layout has likely changed.`,
    );
  }

  const sourcesByPassID = new Map<SkiPassID, Source[]>();
  const entries = new Map<string, SkiPassRosterEntry>();
  for (const block of blocks) {
    sourcesByPassID.set(
      block.pass.id,
      uniquedSources([
        ...(sourcesByPassID.get(block.pass.id) ?? []),
        block.titleSource,
      ]),
    );

    const columns = resolveColumns(grid, headerRow, block);
    // The location cell is only filled in on the first row of each group.
    let location = "";
    for (let row = headerRow + 1; row < grid.length; row++) {
      const rowLocation = cell(grid, row, block.startColumn).trim();
      if (rowLocation.length > 0) {
        location = rowLocation;
      }
      const mountain = cell(grid, row, columns.name)
        .replace(/\s+/g, " ")
        .trim();
      if (mountain.length === 0) {
        continue;
      }
      if (location.length === 0) {
        throw new Error(
          `Ski pass chart roster "${block.pass.name}" lists "${mountain}" with no location.`,
        );
      }

      const memberships = readMemberships(grid, row, block, columns, gid);
      if (memberships.length === 0) {
        continue;
      }
      const key = [block.pass.id, location, mountain].join(" ");
      const existing = entries.get(key);
      if (existing !== undefined) {
        existing.memberships.push(...memberships);
        continue;
      }

      entries.set(key, {
        passID: block.pass.id,
        passName: block.pass.name,
        location,
        mountain,
        memberships,
        baseElevationInMeters:
          columns.base === null
            ? null
            : convert(cell(grid, row, columns.base), METERS_PER_FOOT, 1),
        summitElevationInMeters:
          columns.summit === null
            ? null
            : convert(cell(grid, row, columns.summit), METERS_PER_FOOT, 1),
      });
    }
  }

  const parsed = [...entries.values()].map((entry) => ({
    ...entry,
    memberships: uniqueMemberships(entry.memberships),
  }));
  if (parsed.length < MINIMUM_ROSTER_ENTRIES) {
    throw new Error(
      `Ski pass chart yielded only ${parsed.length} roster entries, expected at least ${MINIMUM_ROSTER_ENTRIES}. The chart layout has likely changed.`,
    );
  }
  const passes = [
    ...new Map(blocks.map((block) => [block.pass.id, block.pass])).values(),
  ];
  const brands = skiPassBrandDefinitions.map((brand) => ({
    type: "skiPassBrand" as const,
    ...brand,
    sources: uniquedSources(
      blocks
        .filter((block) => block.pass.brandID === brand.id)
        .map((block) => block.titleSource),
    ),
  }));
  return { entries: parsed, passes, brands, sourcesByPassID };
}
