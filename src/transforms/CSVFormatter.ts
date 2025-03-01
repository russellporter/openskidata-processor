import GeoJSON from "geojson";
import {
  FeatureType,
  getLiftElevationData,
  getRunColorName,
  getRunElevationData,
  getSourceURL,
  LiftFeature,
  LiftType,
  Location,
  RunDifficulty,
  RunFeature,
  RunStatisticsByDifficulty,
  SkiAreaActivity,
  SkiAreaFeature,
  SkiAreaStatistics,
  SkiAreaSummaryFeature,
  Source,
} from "openskidata-format";
import { Transform } from "stream";

/**
 * Type overloads for formatter function
 */
export function formatter(
  type: FeatureType.SkiArea,
): (feature: SkiAreaFeature) => string;
export function formatter(
  type: FeatureType.Lift,
): (feature: LiftFeature) => string;
export function formatter(
  type: FeatureType.Run,
): (feature: RunFeature) => string;
export function formatter(
  type: FeatureType,
): (feature: SkiAreaFeature | LiftFeature | RunFeature) => string;

/**
 * Creates a formatter function for a specific feature type
 *
 * @param type The feature type to format
 * @returns A function that formats features to CSV strings
 */
export function formatter(
  type: FeatureType,
): (feature: GeoJSON.Feature<any, any>) => string {
  switch (type) {
    case FeatureType.Lift:
      return formatLift;
    case FeatureType.Run:
      return formatRun;
    case FeatureType.SkiArea:
      return formatSkiArea;
    default:
      throw new Error(`Unknown feature type: ${type}`);
  }
}

/**
 * Creates a transform stream that adds CSV headers and handles line breaks
 *
 * @param type The type of feature being processed
 * @returns A transform stream for processing CSV strings
 */
export function createCSVWriteStream(type: FeatureType): Transform {
  const headers = getHeadersForType(type);
  let headerWritten = false;

  return new Transform({
    objectMode: true,
    transform(chunk: string | null, encoding, callback) {
      try {
        if (!headerWritten) {
          this.push(headers + "\n");
          headerWritten = true;
        }

        if (chunk !== null) {
          this.push(chunk + "\n");
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Gets the appropriate filename for a given feature type's CSV export
 *
 * @param type The feature type
 * @returns Filename for the CSV export
 */
export function getCSVFilename(type: FeatureType): string {
  switch (type) {
    case FeatureType.SkiArea:
      return "ski_areas.csv";
    case FeatureType.Run:
      return "runs.csv";
    case FeatureType.Lift:
      return "lifts.csv";
    default:
      throw new Error(`Unknown feature type: ${type}`);
  }
}

/**
 * Gets the appropriate CSV headers for a given feature type
 *
 * @param type The feature type
 * @returns CSV header string
 */
function getHeadersForType(type: FeatureType): string {
  switch (type) {
    case FeatureType.Run:
      return "id,name,ref,country,region,locality,ski_area_names,ski_area_ids,difficulty,color,oneway,lit,gladed,patrolled,grooming,uses,inclined_length_m,descent_m,ascent_m,average_pitch_%,max_pitch_%,min_elevation_m,max_elevation_m,difficulty_convention,wikidata_id,websites,sources,description";
    case FeatureType.Lift:
      return "id,name,ref,country,region,locality,ski_area_names,ski_area_ids,lift_type,status,oneway,duration_sec,capacity,occupancy,detachable,bubble,heating,inclined_length_m,vertical_m,speed_m_per_s,min_elevation_,max_elevation_m,overall_pitch_%,wikidata_id,websites,sources,description";
    case FeatureType.SkiArea:
      return "id,name,country,region,locality,status,has_downhill,has_nordic,downhill_distance_km,nordic_distance_km,vertical_m,min_elevation_m,max_elevation_m,lift_count,surface_lifts_count,run_convention,wikidata_id,websites,sources";
    default:
      throw new Error(`Unknown feature type: ${type}`);
  }
}

function formatRun(feature: RunFeature): string {
  const properties = feature.properties;
  const colorName = getRunColorName(
    properties.difficultyConvention,
    properties.difficulty,
  );

  const elevationData = getRunElevationData(feature);

  return [
    properties.id,
    escapeField(properties.name),
    escapeField(properties.ref),
    ...extractLocationAndSkiAreas(properties.skiAreas),
    properties.difficulty,
    colorName,
    properties.oneway ? "yes" : "no",
    properties.lit ? "yes" : "no",
    properties.gladed ? "yes" : "no",
    properties.patrolled ? "yes" : "no",
    properties.grooming,
    properties.uses.join(";"),
    elevationData?.inclinedLengthInMeters.toFixed(),
    elevationData?.descentInMeters.toFixed(),
    elevationData?.ascentInMeters.toFixed(),
    elevationData?.averagePitchInPercent.toFixed(2),
    elevationData?.maxPitchInPercent.toFixed(2),
    elevationData?.minElevationInMeters.toFixed(),
    elevationData?.maxElevationInMeters.toFixed(),
    properties.difficultyConvention,
    escapeField(properties.wikidata_id),
    formatWebsites(properties.websites),
    formatSources(properties.sources),
    properties.description ? escapeField(properties.description) : "",
  ].join(",");
}

function formatLift(feature: LiftFeature): string {
  const properties = feature.properties;
  const elevationData = getLiftElevationData(feature);

  return [
    properties.id,
    escapeField(properties.name),
    escapeField(properties.ref),
    ...extractLocationAndSkiAreas(properties.skiAreas),
    properties.liftType,
    properties.status,
    properties.oneway ? "yes" : "no",
    properties.duration ? properties.duration.toString() : "",
    properties.capacity ? properties.capacity.toString() : "",
    properties.occupancy ? properties.occupancy.toString() : "",
    properties.detachable ? "yes" : "no",
    properties.bubble ? "yes" : "no",
    properties.heating ? "yes" : "no",
    elevationData?.inclinedLengthInMeters.toFixed(),
    elevationData?.verticalInMeters.toFixed(),
    elevationData?.speedInMetersPerSecond?.toFixed(1),
    elevationData?.minElevationInMeters.toFixed(),
    elevationData?.maxElevationInMeters.toFixed(),
    elevationData?.overallPitchInPercent.toFixed(2),
    escapeField(properties.wikidata_id),
    formatWebsites(properties.websites),
    formatSources(properties.sources),
    properties.description ? escapeField(properties.description) : "",
  ].join(",");
}

function formatSkiArea(feature: SkiAreaFeature): string {
  const properties = feature.properties;
  const statistics = properties.statistics;

  // Calculate lift counts
  const { totalLiftCount, surfaceLiftCount } = calculateLiftCounts(statistics);

  // Check for specific activities
  const hasDownhill = properties.activities.includes(SkiAreaActivity.Downhill)
    ? "yes"
    : "no";
  const hasNordic = properties.activities.includes(SkiAreaActivity.Nordic)
    ? "yes"
    : "no";
  return [
    properties.id,
    escapeField(properties.name),
    ...extractLocation(properties.location),
    properties.status,
    hasDownhill,
    hasNordic,
    statistics?.runs.byActivity.downhill
      ? Math.round(
          getDistance(statistics.runs.byActivity.downhill.byDifficulty),
        ).toString()
      : "",
    statistics?.runs.byActivity.nordic
      ? Math.round(
          getDistance(statistics.runs.byActivity.nordic.byDifficulty),
        ).toString()
      : "",
    statistics?.maxElevation && statistics?.minElevation
      ? Math.round(statistics.maxElevation - statistics.minElevation).toString()
      : "",
    statistics?.minElevation
      ? Math.round(statistics.minElevation).toString()
      : "",
    statistics?.maxElevation
      ? Math.round(statistics.maxElevation).toString()
      : "",
    totalLiftCount > 0 ? totalLiftCount.toString() : "",
    surfaceLiftCount > 0 ? surfaceLiftCount.toString() : "",
    properties.runConvention,
    escapeField(properties.wikidata_id),
    formatWebsites(properties.websites),
    formatSources(properties.sources),
  ].join(",");
}

/**
 * Properly escape a field value according to CSV standards
 *
 * @param value The string value to escape
 * @returns The properly escaped CSV field
 */
function escapeField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";

  // If the field contains commas, quotes, newlines, or other problematic characters,
  // wrap it in quotes and escape any existing quotes (by doubling them)
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes(";")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }

  return value;
}

function extractLocationAndSkiAreas(skiAreas: SkiAreaSummaryFeature[]) {
  const firstSkiArea = skiAreas.length > 0 ? skiAreas[0] : null;
  const locationFields = extractLocation(firstSkiArea?.properties.location);

  const skiAreaIDs = skiAreas.map((area) => area.properties.id).join(";");
  const skiAreaNames = skiAreas
    .filter((name) => name !== null)
    .map((area) => escapeField(area.properties.name))
    .sort()
    .join(";");

  return [...locationFields, skiAreaNames, skiAreaIDs];
}

function extractLocation(location: Location | null | undefined): string[] {
  const country = escapeField(location?.localized.en.country);
  const region = escapeField(location?.localized.en.region);
  const locality = escapeField(location?.localized.en.locality);
  return [country, region, locality];
}

function formatSources(sources: Source[]): string {
  return sources
    .map((source) => escapeField(getSourceURL(source)))
    .sort()
    .join(" ");
}

function formatWebsites(websites: string[]): string {
  return escapeField(websites.sort().join(" "));
}

function getDistance(statistics: RunStatisticsByDifficulty) {
  return Object.keys(statistics).reduce((distance, key) => {
    return distance + statistics[key as RunDifficulty | "other"]!.lengthInKm;
  }, 0);
}

/**
 * Calculate lift counts for ski areas
 */
function calculateLiftCounts(statistics: SkiAreaStatistics | undefined) {
  let totalLiftCount = 0;
  let surfaceLiftCount = 0;

  if (statistics && statistics.lifts) {
    const liftStatistics = statistics.lifts.byType;
    // Count all lifts
    totalLiftCount = Object.values(liftStatistics).reduce(
      (sum, stats) => sum + stats!.count,
      0,
    );

    // Count surface lifts (t-bar, j-bar, platter, rope tow, magic carpet)
    const surfaceTypes = [
      LiftType.TBar,
      LiftType.JBar,
      LiftType.Platter,
      LiftType.RopeTow,
      LiftType.MagicCarpet,
      LiftType.DragLift,
    ];
    surfaceLiftCount = surfaceTypes
      .map((type) => {
        return liftStatistics[type]?.count ?? 0;
      })
      .reduce((sum, count) => sum + count, 0);
  }

  return { totalLiftCount, surfaceLiftCount };
}
