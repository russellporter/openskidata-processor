import centroid from "@turf/centroid";
import * as GeoJSON from "geojson";
import {
  FeatureType,
  getLiftElevationData,
  getRunColorName,
  getRunElevationData,
  getSourceURL,
  LiftFeature,
  LiftType,
  Place,
  RunDifficulty,
  RunFeature,
  RunStatisticsByDifficulty,
  SkiAreaActivity,
  SkiAreaFeature,
  SkiAreaStatistics,
  SkiAreaSummaryFeature,
  Source,
  SpotFeature,
  SpotType,
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
  type: FeatureType.Spot,
): (feature: SpotFeature) => string;
export function formatter(
  type: FeatureType,
): (feature: SkiAreaFeature | LiftFeature | RunFeature | SpotFeature) => string;

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
    case FeatureType.Spot:
      return formatSpot;
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
    case FeatureType.Spot:
      return "spots.csv";
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
      return "name,ref,countries,regions,localities,ski_area_names,difficulty,color,oneway,lit,gladed,patrolled,grooming,uses,inclined_length_m,descent_m,ascent_m,average_pitch_%,max_pitch_%,min_elevation_m,max_elevation_m,difficulty_convention,wikidata_id,websites,openskimap,id,geometry,lat,lng,ski_area_ids,sources,description";
    case FeatureType.Lift:
      return "name,ref,ref_fr_cairn,lift_type,status,access,countries,regions,localities,ski_area_names,oneway,duration_sec,capacity,occupancy,detachable,bubble,heating,inclined_length_m,vertical_m,speed_m_per_s,vertical_speed_m_per_s,min_elevation_m,max_elevation_m,overall_pitch_%,wikidata_id,websites,openskimap,id,geometry,lat,lng,ski_area_ids,sources,description";
    case FeatureType.SkiArea:
      return "name,countries,regions,localities,status,has_downhill,has_nordic,downhill_distance_km,nordic_distance_km,vertical_m,min_elevation_m,max_elevation_m,lift_count,surface_lifts_count,run_convention,wikidata_id,websites,openskimap,id,geometry,lat,lng,sources";
    case FeatureType.Spot:
      return "id,spot_type,longitude,latitude,sources,ski_areas,countries,regions,localities,dismount,name,position,entry,exit";
    default:
      throw new Error(`Unknown feature type: ${type}`);
  }
}

/**
 * Generate an OpenSkiMap URL for a feature
 *
 * @param featureId ID of the feature to generate URL for
 * @returns URL string in the format https://openskimap.org/?obj={id}
 */
function getOpenSkiMapURL(featureId: string): string {
  return `https://openskimap.org/?obj=${featureId}`;
}

/**
 * Get the geometry information of a feature (type and centroid coordinates)
 *
 * @param feature GeoJSON feature
 * @returns Array with [geometryType, lat, lng]
 */
function getGeometry(feature: GeoJSON.Feature): [string, string, string] {
  const geometryType = feature.geometry.type;

  try {
    const centroidFeature = centroid(feature);
    // GeoJSON coordinates are [lng, lat], but we want [lat, lng]
    return [
      geometryType,
      centroidFeature.geometry.coordinates[1].toFixed(6),
      centroidFeature.geometry.coordinates[0].toFixed(6),
    ];
  } catch (e) {
    return [geometryType, "", ""];
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
    escapeField(properties.name),
    escapeField(properties.ref),
    ...extractPlaces(properties.places),
    extractSkiAreaNames(properties.skiAreas),
    properties.difficulty,
    colorName,
    formatBoolean(properties.oneway),
    formatBoolean(properties.lit),
    formatBoolean(properties.gladed),
    formatBoolean(properties.patrolled),
    properties.grooming,
    properties.uses.join(";"),
    elevationData?.inclinedLengthInMeters.toFixed(),
    elevationData?.descentInMeters.toFixed(),
    elevationData?.ascentInMeters.toFixed(),
    elevationData?.averagePitchInPercent?.toFixed(2),
    elevationData?.maxPitchInPercent?.toFixed(2),
    elevationData?.minElevationInMeters.toFixed(),
    elevationData?.maxElevationInMeters.toFixed(),
    properties.difficultyConvention,
    escapeField(properties.wikidataID),
    formatWebsites(properties.websites),
    getOpenSkiMapURL(properties.id),
    properties.id,
    ...getGeometry(feature),
    extractSkiAreaIDs(properties.skiAreas),
    formatSources(properties.sources),
    properties.description ? escapeField(properties.description) : "",
  ].join(",");
}

function formatLift(feature: LiftFeature): string {
  const properties = feature.properties;
  const elevationData = getLiftElevationData(feature);

  return [
    escapeField(properties.name),
    escapeField(properties.ref),
    escapeField(properties.refFRCAIRN),
    properties.liftType,
    properties.status,
    properties.access || "",
    ...extractPlaces(properties.places),
    extractSkiAreaNames(properties.skiAreas),
    formatBoolean(properties.oneway),
    properties.duration ? properties.duration.toString() : "",
    properties.capacity ? properties.capacity.toString() : "",
    properties.occupancy ? properties.occupancy.toString() : "",
    formatBoolean(properties.detachable),
    formatBoolean(properties.bubble),
    formatBoolean(properties.heating),
    elevationData?.inclinedLengthInMeters.toFixed(),
    elevationData?.verticalInMeters.toFixed(),
    elevationData?.speedInMetersPerSecond?.toFixed(1),
    elevationData?.verticalSpeedInMetersPerSecond?.toFixed(2),
    elevationData?.minElevationInMeters.toFixed(),
    elevationData?.maxElevationInMeters.toFixed(),
    elevationData?.overallPitchInPercent?.toFixed(2),
    escapeField(properties.wikidataID),
    formatWebsites(properties.websites),
    getOpenSkiMapURL(properties.id),
    properties.id,
    ...getGeometry(feature),
    extractSkiAreaIDs(properties.skiAreas),
    formatSources(properties.sources),
    properties.description ? escapeField(properties.description) : "",
  ].join(",");
}

function formatSkiArea(feature: SkiAreaFeature): string {
  const properties = feature.properties;
  const statistics = properties.statistics;

  // Calculate lift counts
  const { totalLiftCount, surfaceLiftCount } = calculateLiftCounts(statistics);

  return [
    escapeField(properties.name),
    ...extractPlaces(properties.places),
    properties.status,
    formatBoolean(properties.activities.includes(SkiAreaActivity.Downhill)),
    formatBoolean(properties.activities.includes(SkiAreaActivity.Nordic)),
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
    escapeField(properties.wikidataID),
    formatWebsites(properties.websites),
    getOpenSkiMapURL(properties.id),
    properties.id,
    ...getGeometry(feature),
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

function formatBoolean(value: boolean | null): string {
  if (value === null) return "";
  return value ? "yes" : "no";
}

function extractSkiAreaNames(skiAreas: SkiAreaSummaryFeature[]): string {
  return escapeField(
    skiAreas
      .filter((name) => name !== null)
      .map((area) => area.properties.name)
      .sort()
      .join(","),
  );
}

function extractSkiAreaIDs(skiAreas: SkiAreaSummaryFeature[]) {
  return skiAreas.map((area) => area.properties.id).join(";");
}

function extractPlaces(places: Place[]): string[] {
  // Get unique values for each field
  const uniqueCountries = Array.from(
    new Set(places.map((p) => p.localized.en.country).filter((c) => c)),
  ).sort();
  const uniqueRegions = Array.from(
    new Set(places.map((p) => p.localized.en.region).filter((r) => r)),
  ).sort();
  const uniqueLocalities = Array.from(
    new Set(places.map((p) => p.localized.en.locality).filter((l) => l)),
  ).sort();

  return [
    escapeField(uniqueCountries.join(";")),
    escapeField(uniqueRegions.join(";")),
    escapeField(uniqueLocalities.join(";")),
  ];
}

function formatSources(sources: Source[]): string {
  return escapeField(
    sources
      .map((source) => getSourceURL(source))
      .sort()
      .join(" "),
  );
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

function formatSpot(feature: SpotFeature): string {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  const common = [
    p.id,
    escapeField(p.spotType),
    lng.toFixed(6),
    lat.toFixed(6),
    formatSources(p.sources),
    extractSkiAreaNames(p.skiAreas),
    ...extractPlaces(p.places),
  ];

  // Type-specific columns (fill with empty strings for unused)
  let typeSpecific: string[] = [];
  switch (p.spotType) {
    case SpotType.Crossing:
      typeSpecific = [escapeField(p.dismount), "", "", "", ""];
      break;
    case SpotType.LiftStation:
      typeSpecific = [
        "",
        escapeField(p.name),
        escapeField(p.position),
        formatBoolean(p.entry),
        formatBoolean(p.exit),
      ];
      break;
    default:
      typeSpecific = ["", "", "", "", ""];
  }

  return [...common, ...typeSpecific].join(",");
}
