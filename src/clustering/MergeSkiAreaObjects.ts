import { SkiAreaProperties, SourceType } from "openskidata-format";
import uniquedSources from "../transforms/UniqueSources";
import mergedAndUniqued from "../utils/mergedAndUniqued";
import { SkiAreaObject } from "./MapObject";

export default function mergeSkiAreaObjects(
  skiAreas: SkiAreaObject[]
): SkiAreaObject | null {
  if (skiAreas.length === 0) {
    return null;
  }

  const openStreetMapSkiAreaIndex = skiAreas.findIndex(
    (skiArea) => skiArea.source === SourceType.OPENSTREETMAP
  );
  const primarySkiAreaIndex =
    openStreetMapSkiAreaIndex !== -1 ? openStreetMapSkiAreaIndex : 0;
  const primarySkiArea = skiAreas[primarySkiAreaIndex];
  delete skiAreas[primarySkiAreaIndex];

  return skiAreas.reduce((primarySkiArea, otherSkiArea) => {
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
        otherSkiArea.activities
      ),
      properties: mergeSkiAreaProperties(
        primarySkiArea.properties,
        otherSkiArea.properties
      ),
    };
  }, primarySkiArea);
}

function mergeSkiAreaProperties(
  primarySkiArea: SkiAreaProperties,
  otherSkiArea: SkiAreaProperties
): SkiAreaProperties {
  return {
    id: primarySkiArea.id,
    name: primarySkiArea.name || otherSkiArea.name,
    activities: mergedAndUniqued(
      primarySkiArea.activities,
      otherSkiArea.activities
    ),
    generated: primarySkiArea.generated && otherSkiArea.generated,
    runConvention: primarySkiArea.runConvention,
    sources: uniquedSources(
      primarySkiArea.sources.concat(otherSkiArea.sources)
    ),
    status: primarySkiArea.status || otherSkiArea.status,
    type: primarySkiArea.type,
    websites: mergedWebsites(primarySkiArea, otherSkiArea),
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
        (source) => source.type == SourceType.OPENSTREETMAP
      ) && skiArea.websites.length > 0
  );
  if (openStreetMapSkiAreasWithWebsites.length > 0) {
    return mergedAndUniqued(
      openStreetMapSkiAreasWithWebsites.flatMap((skiArea) => skiArea.websites)
    );
  } else {
    return mergedAndUniqued(skiAreas.flatMap((skiArea) => skiArea.websites));
  }
}
