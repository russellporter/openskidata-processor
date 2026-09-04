import { createWriteStream } from "fs";
import { readFile, rename } from "node:fs/promises";
import { SkiAreaActivity, SkiAreaFeature } from "openskidata-format";
import { pipeline } from "stream/promises";
import { readGeoJSONFeatures } from "../io/GeoJSONReader.js";
import toFeatureCollection from "../transforms/FeatureCollection.js";
import { map } from "../transforms/StreamTransforms.js";
import SkiPassJoiner, { JoinableSkiArea } from "./SkiPassJoiner.js";
import { loadSkiPassOverrides } from "./SkiPassOverrides.js";
import { parseSkiPassChart } from "./SkiPassChartParser.js";
import { SkiPassMatch, SkiPassSkiAreaData } from "./SkiPassTypes.js";
import { writeSkiPassesCSV, writeSkiPassesJSON } from "./SkiPassWriter.js";

export interface SkiPassOutputPaths {
  /** The clustered ski areas, rewritten in place with their ski pass data. */
  skiAreas: string;
  skiPassesJSON: string;
  skiPassesCSV: string;
}

/**
 * A ski area the chart could plausibly be referring to. The chart covers lift-served downhill
 * skiing, so nordic-only areas and ones that are not operating are not candidates, and an
 * unnamed ski area cannot be matched by name.
 */
function toJoinableSkiArea(feature: SkiAreaFeature): JoinableSkiArea | null {
  const properties = feature.properties;
  if (
    properties.name === null ||
    properties.name.length === 0 ||
    !properties.activities.includes(SkiAreaActivity.Downhill) ||
    (properties.status !== null && properties.status !== "operating")
  ) {
    return null;
  }

  return {
    id: properties.id,
    name: properties.name,
    countries: properties.places.map((place) => place.iso3166_1Alpha2),
    subdivisions: properties.places
      .map((place) => place.iso3166_2)
      .filter((code): code is string => code !== null),
    minElevationInMeters: properties.statistics?.minElevation ?? null,
    maxElevationInMeters: properties.statistics?.maxElevation ?? null,
    sources: properties.sources.map((source) => `${source.type}:${source.id}`),
  };
}

function attachSkiPassData(
  feature: SkiAreaFeature,
  data: SkiPassSkiAreaData | undefined,
): SkiAreaFeature {
  feature.properties.skiPasses = data?.skiPasses ?? [];
  return feature;
}

function summarize(matches: SkiPassMatch[]): string {
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match.tier, (counts.get(match.tier) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, count]) => `${tier}: ${count}`)
    .join(", ");
}

/**
 * Joins the ski pass chart to the clustered ski areas, rewriting them with the passes they are
 * on, and writing the ski passes themselves as their own dataset.
 *
 * Runs after clustering because it depends on both the geocoded places and the merged ski areas
 * that clustering produces.
 */
export default async function enrichSkiAreasWithSkiPasses(
  chartPath: string,
  chartSheetID: string,
  overridesPath: string,
  coversEverySkiArea: boolean,
  paths: SkiPassOutputPaths,
): Promise<void> {
  const chart = parseSkiPassChart(
    await readFile(chartPath, "utf8"),
    chartSheetID,
  );
  const joiner = new SkiPassJoiner(
    chart,
    loadSkiPassOverrides(overridesPath),
    coversEverySkiArea,
  );

  const candidates: JoinableSkiArea[] = [];
  await pipeline(
    readGeoJSONFeatures(paths.skiAreas),
    map((feature: SkiAreaFeature) => {
      const candidate = toJoinableSkiArea(feature);
      if (candidate !== null) {
        candidates.push(candidate);
      }
      return feature;
    }),
    // The features themselves are not needed on this pass, only the candidate list.
    async function drain(source) {
      for await (const _ of source) {
      }
    },
  );

  const result = joiner.join(candidates);

  const temporaryPath = `${paths.skiAreas}.skipasses`;
  await pipeline(
    readGeoJSONFeatures(paths.skiAreas),
    map((feature: SkiAreaFeature) =>
      attachSkiPassData(feature, result.skiAreaData.get(feature.properties.id)),
    ),
    toFeatureCollection(),
    createWriteStream(temporaryPath),
  );
  await rename(temporaryPath, paths.skiAreas);

  await writeSkiPassesJSON(paths.skiPassesJSON, result.catalog);
  await writeSkiPassesCSV(paths.skiPassesCSV, result.matches);

  console.log(
    `Joined ${chart.entries.length} ski pass roster entries covering ${result.skiAreaData.size} ski areas (${summarize(result.matches)})`,
  );
}
