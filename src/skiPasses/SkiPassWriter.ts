import { writeFile } from "node:fs/promises";
import { escapeField } from "../transforms/CSVFormatter";
import { SkiPass, SkiPassMatch } from "./SkiPassTypes";

const CSV_HEADERS = [
  "pass_id",
  "pass_name",
  "ski_area_id",
  "ski_area_name",
  "roster_name",
  "roster_location",
  "tier",
  "access",
  "year_joined",
  "match_tier",
].join(",");

/** The ski passes themselves, with the ski areas each one covers. */
export async function writeSkiPassesJSON(
  path: string,
  passes: SkiPass[],
): Promise<void> {
  await writeFile(path, JSON.stringify(passes, null, 2) + "\n");
}

/**
 * One row per ski pass tier a ski area is on, which is the shape that loads directly into a
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
          escapeField(membership.passID),
          escapeField(membership.passName),
          escapeField(skiAreaID),
          escapeField(match.skiAreaNames[index]),
          escapeField(match.entry.mountain),
          escapeField(match.entry.location),
          escapeField(membership.tier),
          escapeField(membership.access),
          membership.yearJoined ?? "",
          escapeField(match.tier),
        ].join(","),
      ),
    ),
  );
  await writeFile(path, [CSV_HEADERS, ...rows].join("\n") + "\n");
}
