import {
  FeatureType,
  RunConvention,
  SkiAreaFeature,
  SkiAreaProperties,
  SourceType,
} from "openskidata-format";
import { osmID } from "../features/OSMGeoJSONProperties";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature,
  OSMSkiAreaSite,
  OSMSkiAreaTags,
} from "../features/SkiAreaFeature";
import notEmpty from "../utils/notEmpty";
import buildFeature from "./FeatureBuilder";
import { Omit } from "./Omit";
import { getRunConvention } from "./RunFormatter";
import getStatusAndValue from "./Status";

export enum InputSkiAreaType {
  SKIMAP_ORG,
  OPENSTREETMAP_LANDUSE,
  OPENSTREETMAP_SITE,
}

export function formatSkiArea(
  type: InputSkiAreaType.OPENSTREETMAP_LANDUSE
): (feature: InputOpenStreetMapSkiAreaFeature) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType.OPENSTREETMAP_SITE
): (feature: OSMSkiAreaSite) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType.SKIMAP_ORG
): (feature: InputSkiMapOrgSkiAreaFeature) => SkiAreaFeature | null;

export function formatSkiArea(
  type: InputSkiAreaType
): (
  feature:
    | InputSkiMapOrgSkiAreaFeature
    | InputOpenStreetMapSkiAreaFeature
    | OSMSkiAreaSite
) => SkiAreaFeature | null {
  return (feature) => {
    switch (type) {
      case InputSkiAreaType.OPENSTREETMAP_LANDUSE:
        const osmFeature = feature as InputOpenStreetMapSkiAreaFeature;
        if (
          osmFeature.properties.tags["sport"] !== undefined &&
          osmFeature.properties.tags["sport"] !== "skiing" &&
          osmFeature.properties.tags["sport"] !== "ski"
        ) {
          return null;
        }
        if (
          osmFeature.geometry.type !== "Polygon" &&
          osmFeature.geometry.type !== "MultiPolygon"
        ) {
          return null;
        }

        return buildFeature(
          osmFeature.geometry,
          propertiesForOpenStreetMapSkiArea(
            osmID(osmFeature.properties),
            osmFeature.properties.tags,
            getRunConvention(osmFeature)
          )
        );
      case InputSkiAreaType.OPENSTREETMAP_SITE:
        const osmSiteObject = feature as OSMSkiAreaSite;
        return buildFeature(
          // super hacky thing, we don't know the coordinates of the site at this point.
          // later on the correct geometry will be set when doing clustering.
          // to get a stable identifier for the site, build a geometry based on its ID (which is then hashed by `buildFeature`)
          { type: "Point", coordinates: [360, 360, osmSiteObject.id] },
          propertiesForOpenStreetMapSkiArea(
            osmID(osmSiteObject),
            osmSiteObject.tags,
            RunConvention.NORTH_AMERICA // also bogus, will be updated later when we know the real geometry
          )
        );
      case InputSkiAreaType.SKIMAP_ORG:
        const skiMapFeature = feature as InputSkiMapOrgSkiAreaFeature;
        return buildFeature(
          skiMapFeature.geometry,
          propertiesForSkiMapOrgSkiArea(
            skiMapFeature as InputSkiMapOrgSkiAreaFeature
          )
        );
    }
  };
}

function propertiesForOpenStreetMapSkiArea(
  osmID: string,
  tags: OSMSkiAreaTags,
  runConvention: RunConvention
): Omit<SkiAreaProperties, "id"> {
  return {
    type: FeatureType.SkiArea,
    name: tags.name || null,
    sources: [
      {
        type: SourceType.OPENSTREETMAP,
        id: osmID,
      },
    ],
    activities: [],
    generated: false,
    // We don't care about the value here, just get the status. The value is always "winter_sports".
    status: getStatusAndValue("landuse", tags as { [key: string]: string })
      .status,
    websites: [tags.website].filter(notEmpty),
    runConvention: runConvention,
    location: null,
  };
}

function propertiesForSkiMapOrgSkiArea(
  feature: InputSkiMapOrgSkiAreaFeature
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
    generated: false,
    status: feature.properties.status,
    runConvention: getRunConvention(feature),
    websites: [feature.properties.official_website].filter(notEmpty),
    location: null,
  };
}
