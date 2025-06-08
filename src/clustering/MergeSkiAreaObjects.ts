import { SkiAreaProperties, SourceType } from "openskidata-format";
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

  // Assert that merging is not used for ski areas with pixels set
  // This should not happen in the current use case
  if (primarySkiArea.viirsPixels.length > 0 || Object.keys(primarySkiArea.viirsPixelsByActivity || {}).length > 0) {
    throw new Error("Cannot merge ski areas that have VIIRS pixels set. This operation should happen before pixel extraction.");
  }
  
  for (const skiArea of otherSkiAreas) {
    if (skiArea.viirsPixels.length > 0 || Object.keys(skiArea.viirsPixelsByActivity || {}).length > 0) {
      throw new Error("Cannot merge ski areas that have VIIRS pixels set. This operation should happen before pixel extraction.");
    }
  }

  return otherSkiAreas.reduce((primarySkiArea, otherSkiArea) => {
    return {
      _id: primarySkiArea._id,
      _key: primarySkiArea._key,
      id: primarySkiArea.id,
      geometry: primarySkiArea.geometry,
      isPolygon: primarySkiArea.isPolygon,
      skiAreas: primarySkiArea.skiAreas,
      source: primarySkiArea.source,
      type: primarySkiArea.type,
      activities: mergedAndUniqued(
        primarySkiArea.activities,
        otherSkiArea.activities,
      ),
      viirsPixels: [],
      viirsPixelsByActivity: {},
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
    wikidata_id: primarySkiArea.wikidata_id || otherSkiArea.wikidata_id,
    statistics: primarySkiArea.statistics,
    location: null,
  };
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
