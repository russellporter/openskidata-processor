import {
  FeatureType,
  RunDifficultyConvention,
  SkiAreaFeature,
  SkiAreaProperties,
  SourceType,
  Status,
} from "openskidata-format";
import { osmID } from "../features/OSMGeoJSONProperties";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature,
  OSMSkiAreaSite,
  OSMSkiAreaTags,
} from "../features/SkiAreaFeature";
import placeholderSiteGeometry from "../utils/PlaceholderSiteGeometry";
import notEmpty from "../utils/notEmpty";
import buildFeature from "./FeatureBuilder";
import { getOSMFirstValue, getOSMName } from "./OSMTransforms";
import { Omit } from "./Omit";
import { getRunDifficultyConvention } from "openskidata-format";
import getStatusAndValue from "./Status";

export enum InputSkiAreaType {
  SKIMAP_ORG,
  OPENSTREETMAP_LANDUSE,
  OPENSTREETMAP_SITE,
}

export function formatSkiArea(
  type: InputSkiAreaType.OPENSTREETMAP_LANDUSE,
): (feature: InputOpenStreetMapSkiAreaFeature) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType.OPENSTREETMAP_SITE,
): (feature: OSMSkiAreaSite) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType.SKIMAP_ORG,
): (feature: InputSkiMapOrgSkiAreaFeature) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType,
): (
  feature:
    | InputSkiMapOrgSkiAreaFeature
    | InputOpenStreetMapSkiAreaFeature
    | OSMSkiAreaSite,
) => SkiAreaFeature | null {
  return (feature) => {
    switch (type) {
      case InputSkiAreaType.OPENSTREETMAP_LANDUSE:
        return formatOpenStreetMapLanduse(
          feature as InputOpenStreetMapSkiAreaFeature,
        );
      case InputSkiAreaType.OPENSTREETMAP_SITE:
        return formatOpenStreetMapSite(feature as OSMSkiAreaSite);
      case InputSkiAreaType.SKIMAP_ORG:
        return formatSkiMapOrg(feature as InputSkiMapOrgSkiAreaFeature);
    }
  };
}

function formatOpenStreetMapLanduse(
  feature: InputOpenStreetMapSkiAreaFeature,
): SkiAreaFeature | null {
  const osmFeature = feature as InputOpenStreetMapSkiAreaFeature;
  const tags = osmFeature.properties.tags;
  if (
    tags["sport"] !== undefined &&
    tags["sport"] !== "skiing" &&
    tags["sport"] !== "ski"
  ) {
    return null;
  }
  if (
    osmFeature.geometry.type !== "Polygon" &&
    osmFeature.geometry.type !== "MultiPolygon"
  ) {
    return null;
  }

  // We don't care about the value here, just get the status. The value is always "winter_sports".
  const status = getStatusAndValue(
    "landuse",
    tags as { [key: string]: string },
  ).status;

  if (status === null) {
    return null;
  }

  return buildFeature(
    osmFeature.geometry,
    propertiesForOpenStreetMapSkiArea(
      osmID(osmFeature.properties),
      osmFeature.properties.tags,
      status,
      getRunDifficultyConvention(osmFeature),
    ),
  );
}

function formatOpenStreetMapSite(site: OSMSkiAreaSite): SkiAreaFeature | null {
  // We don't care about the value here, just get the status. The value is always "piste".
  const status = getStatusAndValue(
    "site",
    site.tags as { [key: string]: string },
  ).status;

  if (status === null) {
    return null;
  }

  return buildFeature(
    // super hacky thing, we don't know the coordinates of the site at this point.
    // later on the correct geometry will be set when doing clustering.
    // to get a stable identifier for the site, build a geometry based on its ID (which is then hashed by `buildFeature`)
    placeholderSiteGeometry(site.id),
    propertiesForOpenStreetMapSkiArea(
      osmID(site),
      site.tags,
      status,
      RunDifficultyConvention.NORTH_AMERICA, // also bogus, will be updated later when we know the real geometry
    ),
  );
}

function formatSkiMapOrg(
  feature: InputSkiMapOrgSkiAreaFeature,
): SkiAreaFeature | null {
  return buildFeature(
    feature.geometry,
    propertiesForSkiMapOrgSkiArea(feature as InputSkiMapOrgSkiAreaFeature),
  );
}

function propertiesForOpenStreetMapSkiArea(
  osmID: string,
  tags: OSMSkiAreaTags,
  status: Status,
  runConvention: RunDifficultyConvention,
): Omit<SkiAreaProperties, "id"> {
  return {
    type: FeatureType.SkiArea,
    name: getOSMName(tags, "name", null, null),
    sources: [
      {
        type: SourceType.OPENSTREETMAP,
        id: osmID,
      },
    ],
    activities: [],
    status: status,
    websites: [tags.website].filter(notEmpty),
    wikidata_id: getOSMFirstValue(tags, "wikidata"),
    runConvention: runConvention,
    location: null,
  };
}

function propertiesForSkiMapOrgSkiArea(
  feature: InputSkiMapOrgSkiAreaFeature,
): Omit<SkiAreaProperties, "id"> {
  const activities = feature.properties.activities;
  return {
    type: FeatureType.SkiArea,
    name: feature.properties.name || null,
    sources: [
      {
        type: SourceType.SKIMAP_ORG,
        id: feature.properties.id,
      },
    ],
    activities: activities,
    status: feature.properties.status,
    runConvention: getRunDifficultyConvention(feature),
    websites: [feature.properties.official_website].filter(notEmpty),
    // TODO: #153 Get Wikidata ID from Skimap.org ID (https://github.com/russellporter/openskimap.org/issues/153)
    wikidata_id: null,
    location: null,
  };
}
