import { assert } from "console";
import { lifecycleStates } from "../transforms/Status";

export interface OSMDownloadConfig {
  query: (bbox: GeoJSON.BBox | null) => string;
  shouldIncludeFeature: (tags: { [key: string]: string }) => boolean;
}

export const runsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};(
      way["piste:type"];
      rel["piste:type"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: (tags) => tags["piste:type"] !== undefined,
};

export const liftsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};(
      way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
      way[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: (tags) =>
    lifecyclePrefixes.some((prefix) => {
      tags[prefix + "aerialway"] !== undefined ||
        tags[prefix + "railway"] === "funicular";
    }) ||
    (tags.rack !== undefined && tags.rack !== "no"),
};

export const skiAreasDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};(
      way[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
      rel[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: (tags) =>
    lifecyclePrefixes.some((prefix) => {
      tags[prefix + "landuse"] === "winter_sports";
    }),
};
export const skiMapSkiAreasURL = "https://skimap.org/SkiAreas/index.geojson";

const lifecyclePrefixes = (() => {
  const statePrefixes = [...lifecycleStates].map((state) => state + ":");
  return ["", ...statePrefixes];
})();

function bboxQuery(bbox: GeoJSON.BBox | null) {
  if (bbox === null) {
    return "";
  }
  assert(bbox.length == 4, "Only 2d boxes are supported");
  // south,west,north,east
  return `[bbox:${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}]`;
}
