import { assert } from "console";
import { lifecycleStates } from "../transforms/Status";

export interface OSMDownloadConfig {
  query: (bbox: GeoJSON.BBox | null) => string;
}

export const runsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};
    wr["piste:type"];
    (._; >;);
    out;
    `
};

export const liftsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};
    rel[site=piste];
    >>;
    way(r)[railway]->.siterailways;
    way[railway=funicular]->.funiculars;
    way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"]->.aerialways;
    ((.aerialways; .siterailways; .funiculars;); >;);
    out;
    `
};

export const skiAreasDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${bboxQuery(bbox)};
    wr[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
    (._; >;);
    out;
    `
};

export const skiAreaSitesDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
  [out:json][timeout:1800]${bboxQuery(bbox)};
  rel[site=piste];
  out;
  `
};

export const pointsOfInterestDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
  [out:json][timeout:1800]${bboxQuery(bbox)};
  rel[site=piste]->.sites;
  (way(r.sites)[!"piste:type"][!"aerialway"][!"railway"];
  node(r.sites);)->.pois;
  (.pois; .pois>;);
  out;
  `
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
