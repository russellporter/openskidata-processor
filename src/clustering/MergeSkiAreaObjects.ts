import { Activity, SkiAreaProperties, SourceType } from "openskidata-format";
import uniquedSources from "../transforms/UniqueSources";
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
      activities: mergeActivities(
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
    name: primarySkiArea.name,
    activities: mergeActivities(
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
    website: primarySkiArea.website || otherSkiArea.website,
    statistics: primarySkiArea.statistics,
    location: null,
  };
}

function mergeActivities(
  primaryActivities: Activity[],
  otherActivities: Activity[]
) {
  return Array.from(new Set([...primaryActivities, ...otherActivities]));
}
