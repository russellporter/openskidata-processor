import { lifecycleStates } from "../transforms/Status";

export interface OSMDownloadConfig {
  query: string;
  shouldIncludeFeature: (tags: { [key: string]: string }) => boolean;
}

export const runsDownloadConfig: OSMDownloadConfig = {
  query: `
    [out:json][timeout:1800];(
      way["piste:type"];
      rel["piste:type"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: tags => tags["piste:type"] !== undefined
};

export const liftsDownloadConfig: OSMDownloadConfig = {
  query: `
    [out:json][timeout:1800];(
      way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
      way[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
      way["^rack$"~"^(yes|riggenbach|strub|abt|locher)$"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: tags =>
    lifecyclePrefixes.some(prefix => {
      tags[prefix + "aerialway"] !== undefined ||
        tags[prefix + "railway"] === "funicular";
    }) ||
    (tags.rack !== undefined && tags.rack !== "no")
};

export const skiAreasDownloadConfig: OSMDownloadConfig = {
  query: `
    [out:json][timeout:1800];(
      way[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
      rel[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
    );
    (._; >;);
    out;
    `,
  shouldIncludeFeature: tags =>
    lifecyclePrefixes.some(prefix => {
      tags[prefix + "landuse"] === "winter_sports";
    })
};
export const skiMapSkiAreasURL = "https://skimap.org/SkiAreas/index.geojson";

const lifecyclePrefixes = (() => {
  const statePrefixes = [...lifecycleStates].map(state => state + ":");
  return ["", ...statePrefixes];
})();
