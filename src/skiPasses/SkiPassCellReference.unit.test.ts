import { getSourceURL } from "openskidata-format";
import { skiPassChartSource } from "./SkiPassCellReference.js";

function reference(gid: string, row: number, column: number): string {
  return skiPassChartSource(gid, row, column).id;
}

describe("skiPassChartSource", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [33, "AH"],
    [51, "AZ"],
    [52, "BA"],
    [270, "JK"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("converts column %i to %s", (column, letters) => {
    expect(reference("1", 0, column)).toBe(`1!${letters}1`);
  });

  it("makes the row one-based", () => {
    expect(reference("677843907", 7, 1)).toBe("677843907!B8");
  });

  it.each([
    [-1, 0],
    [0, -1],
    [0.5, 0],
  ])("rejects out of range coordinates (%p, %p)", (row, column) => {
    expect(() => reference("1", row, column)).toThrow();
  });

  it("resolves to a link to the cell", () => {
    expect(getSourceURL(skiPassChartSource("677843907", 63, 34))).toBe(
      "https://docs.google.com/spreadsheets/d/1G2-l2DVg7-QwroOi7EqRDrJYJ4ICYLcJbLx-nARJdrA/edit?gid=677843907#gid=677843907&range=AI64",
    );
  });
});
