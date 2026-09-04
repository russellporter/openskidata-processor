import { writeFile } from "node:fs/promises";
import { SkiPassCatalog } from "openskidata-format";
import { escapeField } from "../transforms/CSVFormatter";
import { SkiPassMatch } from "./SkiPassTypes";

const CSV_HEADERS = [
  "brand_id",
  "brand_name",
  "pass_id",
  "pass_name",
  "ski_area_id",
  "ski_area_name",
  "roster_name",
  "roster_location",
  "access",
  "year_joined",
  "match_tier",
].join(",");

/** The brands and actual passes, with the ski areas each pass covers. */
export async function writeSkiPassesJSON(
  path: string,
  catalog: SkiPassCatalog,
): Promise<void> {
  await writeFile(path, JSON.stringify(catalog, null, 2) + "\n");
}

/**
 * One row per actual ski pass a ski area is on, which is the shape that loads directly into a
 * spreadsheet or a database table. `match_tier` records how the join was made, so a questionable
 * row can be traced back without re-running the pipeline.
 */
export async function writeSkiPassesCSV(
  path: string,
  matches: SkiPassMatch[],
): Promise<void> {
  const rows = matches.flatMap((match) =>
    match.skiAreaIDs.flatMap((skiAreaID, index) =>
      match.entry.memberships.map((membership) =>
        [
          escapeField(membership.brandID),
          escapeField(membership.brandName),
          escapeField(membership.passID),
          escapeField(membership.passName),
          escapeField(skiAreaID),
          escapeField(match.skiAreaNames[index]),
          escapeField(match.entry.mountain),
          escapeField(match.entry.location),
          escapeField(membership.access),
          membership.yearJoined ?? "",
          escapeField(match.tier),
        ].join(","),
      ),
    ),
  );
  await writeFile(path, [CSV_HEADERS, ...rows].join("\n") + "\n");
}
