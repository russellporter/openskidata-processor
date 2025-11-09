import {
  FeatureType,
  getRunDifficultyConvention,
  RunDifficulty,
  RunDifficultyConvention,
  RunFeature,
  RunGrooming,
  RunProperties,
  RunUse,
  SourceType,
  Status,
} from "openskidata-format";
import { osmID } from "../features/OSMGeoJSONProperties";
import { InputRunFeature, OSMRunTags } from "../features/RunFeature";
import notEmpty from "../utils/notEmpty";
import buildFeature from "./FeatureBuilder";
import { isValidGeometryInFeature } from "./GeoTransforms";
import { Omit } from "./Omit";
import {
  getOrElse,
  getOSMFirstValue,
  getOSMName,
  getOSMRef,
  mapOSMBoolean,
  mapOSMString,
} from "./OSMTransforms";
import getStatusAndValue from "./Status";

export function formatRun(feature: InputRunFeature): RunFeature[] {
  if (feature.geometry.type === "Point") {
    return [];
  }

  if (!isValidGeometryInFeature(feature)) {
    return [];
  }

  const tags = feature.properties.tags;

  const { status, uses } = getStatusAndUses(tags);
  if (uses.length === 0) {
    return [];
  }

  if (status !== Status.Operating) {
    return [];
  }

  const ref = getOSMRef(tags);
  const properties: Omit<RunProperties, "id"> = {
    type: FeatureType.Run,
    uses: uses,
    name: getOSMName(tags, "piste:name", "name", ref),
    ref: ref,
    description: mapOSMString(
      getOrElse(tags, "piste:description", "description"),
    ),
    difficulty: getDifficulty(tags),
    difficultyConvention: getRunDifficultyConvention(feature),
    oneway: getOneway(tags, uses),
    gladed: getGladed(tags),
    patrolled: mapOSMBoolean(getOrElse(tags, "piste:patrolled", "patrolled")),
    lit: mapOSMBoolean(getOrElse(tags, "piste:lit", "lit")),
    grooming: getGrooming(tags),
    skiAreas: [],
    status: status,
    sources: [
      { type: SourceType.OPENSTREETMAP, id: osmID(feature.properties) },
    ],
    websites: [tags.website].filter(notEmpty),
    wikidataID: getOSMFirstValue(tags, "wikidata"),
    places: [],
    elevationProfile: null,
  };

  // Handle MultiPolygon by splitting into separate Polygon features
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((polygonCoords) => {
      const polygonGeometry: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: polygonCoords,
      };
      return buildFeature(polygonGeometry, properties);
    });
  } else if (feature.geometry.type === "MultiLineString") {
    return feature.geometry.coordinates.map((lineCoords) => {
      const lineGeometry: GeoJSON.LineString = {
        type: "LineString",
        coordinates: lineCoords,
      };
      return buildFeature(lineGeometry, properties);
    });
  }

  return [buildFeature(feature.geometry, properties)];
}

function getStatusAndUses(tags: OSMRunTags) {
  let { status, value: pisteType } = getStatusAndValue(
    "piste:type",
    tags as { [key: string]: string },
  );

  // Special case status check for runs: https://wiki.openstreetmap.org/wiki/Piste_Maps
  if (tags["piste:abandoned"] === "yes") {
    status = Status.Abandoned;
  }

  const uses = pisteType !== null ? getUses(pisteType) : [];
  return { status, uses };
}

function getUses(type: string): RunUse[] {
  return type
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .flatMap((t) =>
      Object.values(RunUse).includes(t as RunUse) ? [t as RunUse] : [],
    );
}

function getGladed(tags: OSMRunTags): boolean | null {
  const gladedTag = mapOSMBoolean(getOrElse(tags, "piste:gladed", "gladed"));
  if (gladedTag !== null) {
    return gladedTag;
  }

  if (tags["natural"] === "wood" || tags["landuse"] === "forest") {
    return true;
  }

  return null;
}

function getOneway(tags: OSMRunTags, uses: RunUse[]): boolean | null {
  const value = mapOSMBoolean(getOrElse(tags, "piste:oneway", "oneway"));
  if (value !== null) {
    return value;
  }

  if (uses.includes(RunUse.Downhill)) {
    return true;
  }

  return null;
}


function getGrooming(tags: OSMRunTags): RunGrooming | null {
  const value = tags["piste:grooming"]?.replace(";", "+");
  if (value) {
    const values = new Set(value.split("+"));

    if (values.has(RunGrooming.Classic) && values.has(RunGrooming.Skating)) {
      return RunGrooming.ClassicAndSkating;
    }

    if (Object.values(RunGrooming).includes(value as RunGrooming)) {
      return value as RunGrooming;
    }
  }

  // Default to piste:grooming = backcountry for the most difficult runs
  if (
    tags["piste:difficulty"] === "expert" ||
    tags["piste:difficulty"] === "freeride" ||
    tags["piste:difficulty"] === "extreme"
  ) {
    return RunGrooming.Backcountry;
  }

  if (tags["piste:grooming"] === "no") {
    return RunGrooming.Backcountry;
  }

  return null;
}

function getDifficulty(tags: OSMRunTags): RunDifficulty | null {
  const value = tags["piste:difficulty"];
  return value && Object.values(RunDifficulty).includes(value as RunDifficulty)
    ? (value as RunDifficulty)
    : null;
}
