import { Source, SourceType } from "openskidata-format";

/**
 * Converts a zero-based column index to spreadsheet column letters: 0 -> "A", 25 -> "Z",
 * 26 -> "AA", 270 -> "JK".
 */
function columnLetters(column: number): string {
  if (!Number.isInteger(column) || column < 0) {
    throw new Error(`Invalid spreadsheet column index ${column}.`);
  }

  let letters = "";
  for (let remaining = column + 1; remaining > 0;) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = (remaining - 1 - digit) / 26;
  }
  return letters;
}

/**
 * A reference to a single cell of the ski pass chart, in `<gid>!<A1>` form, which
 * `getSourceURL` resolves to a link that opens the spreadsheet with that cell selected.
 *
 * The chart is read from a CSV export, which starts at A1 and keeps each spreadsheet row on one
 * logical CSV row (newlines within a cell are quoted), so the CSV row and column indices map
 * directly onto spreadsheet coordinates.
 */
function skiPassChartCellReference(
  gid: string,
  row: number,
  column: number,
): string {
  if (!Number.isInteger(row) || row < 0) {
    throw new Error(`Invalid spreadsheet row index ${row}.`);
  }
  return `${gid}!${columnLetters(column)}${row + 1}`;
}

/** Source for a single cell of the ski pass chart. */
export function skiPassChartSource(
  gid: string,
  row: number,
  column: number,
): Source {
  return {
    type: SourceType.STORM_SKIING,
    id: skiPassChartCellReference(gid, row, column),
  };
}
