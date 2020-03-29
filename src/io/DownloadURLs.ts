export const runsURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  way["piste:type"];
  rel["piste:type"];
);
(._; >;);
out;
`);

export const liftsURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  way[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
  rel[~"^([A-Za-z]+:)?aerialway$"~"^.*$"];
  way[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
  rel[~"^([A-Za-z]+:)?railway$"~"^funicular$"];
);
(._; >;);
out;
`);

export const skiAreasURL = overpassURLForQuery(`
[out:json][timeout:1800];(
  node[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
  way[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
  rel[~"^([A-Za-z]+:)?landuse$"~"^winter_sports$"];
);
(._; >;);
out;
`);

export const skiMapSkiAreasURL = "https://skimap.org/SkiAreas/index.geojson";

function overpassURLForQuery(query: string) {
  return (
    "http://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query)
  );
}
