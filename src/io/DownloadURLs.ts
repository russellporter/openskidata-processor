import overpassBBoxQuery from "../utils/overpassBBoxQuery";

export interface OSMDownloadConfig {
  query: (bbox: GeoJSON.BBox | null) => string;
}

export const runsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${overpassBBoxQuery(bbox)};
    wr["piste:type"];
    (._; >;);
    out;
    `,
};

export const liftsDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${overpassBBoxQuery(bbox)};
    rel[site=piste];
    >>;
    way(r)[railway]->.siterailways;
    way[railway=funicular]->.funiculars;
    way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"]->.aerialways;
    ((.aerialways; .siterailways; .funiculars;); >;);
    out;
    `,
};

export const skiAreasDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
    [out:json][timeout:1800]${overpassBBoxQuery(bbox)};
    wr[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
    (._; >;);
    out;
    `,
};

export const skiAreaSitesDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
  [out:json][timeout:1800]${overpassBBoxQuery(bbox)};
  rel[site=piste];
  out;
  `,
};

export const pointsOfInterestDownloadConfig: OSMDownloadConfig = {
  query: (bbox) => `
  [out:json][timeout:1800]${overpassBBoxQuery(bbox)};
  rel[site=piste]->.sites;
  (way(r.sites)[!"piste:type"][!"aerialway"][!"railway"];
  node(r.sites);)->.pois;
  (.pois; .pois>;);
  out;
  `,
};

export const skiMapSkiAreasURL = "https://skimap.org/SkiAreas/index.geojson";
