import { Place, SkiAreaProperties, SourceType } from "openskidata-format";
import uniquedSources from "../transforms/UniqueSources";
import mergedAndUniqued from "../utils/mergedAndUniqued";
import { VIIRSPixel } from "../utils/VIIRSPixelExtractor";
import { SkiAreaObject } from "./MapObject";

export default function mergeSkiAreaObjects(
  primarySkiArea: SkiAreaObject,
  otherSkiAreas: SkiAreaObject[],
): SkiAreaObject {
  if (otherSkiAreas.length === 0) {
    return primarySkiArea;
  }

  return otherSkiAreas.reduce((primarySkiArea, otherSkiArea) => {
    // Check if either ski area has placeholder geometry [360,360,...]
    const primaryHasPlaceholder =
      primarySkiArea.geometry.type === "Point" &&
      primarySkiArea.geometry.coordinates[0] === 360 &&
      primarySkiArea.geometry.coordinates[1] === 360;
    const otherHasPlaceholder =
      otherSkiArea.geometry.type === "Point" &&
      otherSkiArea.geometry.coordinates[0] === 360 &&
      otherSkiArea.geometry.coordinates[1] === 360;

    // Prefer geometry from the ski area that doesn't have placeholder coordinates
    const mergedGeometry =
      primaryHasPlaceholder && !otherHasPlaceholder
        ? otherSkiArea.geometry
        : primarySkiArea.geometry;
    const mergedIsPolygon =
      primaryHasPlaceholder && !otherHasPlaceholder
        ? otherSkiArea.isPolygon
        : primarySkiArea.isPolygon;

    return {
      _id: primarySkiArea._id,
      _key: primarySkiArea._key,
      id: primarySkiArea.id,
      geometry: mergedGeometry,
      isPolygon: mergedIsPolygon,
      skiAreas: primarySkiArea.skiAreas,
      source: primarySkiArea.source,
      type: primarySkiArea.type,
      activities: mergedAndUniqued(
        primarySkiArea.activities,
        otherSkiArea.activities,
      ),
      properties: mergeSkiAreaProperties(
        primarySkiArea.properties,
        otherSkiArea.properties,
      ),
    };
  }, primarySkiArea);
}

function mergeSkiAreaProperties(
  primarySkiArea: SkiAreaProperties,
  otherSkiArea: SkiAreaProperties,
): SkiAreaProperties {
  return {
    id: primarySkiArea.id,
    name: primarySkiArea.name || otherSkiArea.name,
    activities: mergedAndUniqued(
      primarySkiArea.activities,
      otherSkiArea.activities,
    ),
    runConvention: primarySkiArea.runConvention,
    sources: uniquedSources(
      primarySkiArea.sources.concat(otherSkiArea.sources),
    ),
    status: primarySkiArea.status || otherSkiArea.status,
    type: primarySkiArea.type,
    websites: mergedWebsites(primarySkiArea, otherSkiArea),
    wikidataID: primarySkiArea.wikidataID || otherSkiArea.wikidataID,
    statistics: primarySkiArea.statistics,
    places: uniquePlaces([...primarySkiArea.places, ...otherSkiArea.places]),
  };
}

function uniquePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();

  return places.filter((place) => {
    // Create a unique key from the place's identifying properties
    const key = JSON.stringify({
      iso3166_1Alpha2: place.iso3166_1Alpha2,
      iso3166_2: place.iso3166_2,
      locality: place.localized.en.locality,
    });

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergedWebsites(...skiAreas: SkiAreaProperties[]): string[] {
  // Both Skimap.org & OpenStreetMap sourced ski areas often have websites associated with them
  // In order to avoid duplicate links when merging Skimap.org & OpenStreetMap ski areas, prefer the OpenStreetMap sourced data.
  // Often the URLs are just slightly different, so can't be easily de-duped.
  const openStreetMapSkiAreasWithWebsites = skiAreas.filter(
    (skiArea) =>
      skiArea.sources.every(
        (source) => source.type == SourceType.OPENSTREETMAP,
      ) && skiArea.websites.length > 0,
  );
  if (openStreetMapSkiAreasWithWebsites.length > 0) {
    return mergedAndUniqued(
      openStreetMapSkiAreasWithWebsites.flatMap((skiArea) => skiArea.websites),
    );
  } else {
    return mergedAndUniqued(skiAreas.flatMap((skiArea) => skiArea.websites));
  }
}
