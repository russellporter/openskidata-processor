import {
  convertOSMToGeoJSON,
  OverpassElement,
  OSMTags,
} from "./OSMToGeoJSONConverter.js";

function node(id: number, lon: number, lat: number, tags?: OSMTags) {
  return { type: "node" as const, id, lon, lat, tags };
}

function way(id: number, nodes: number[], tags?: OSMTags) {
  return { type: "way" as const, id, nodes, tags };
}

function relation(
  id: number,
  members: { type: string; ref: number; role: string }[],
  tags: OSMTags,
) {
  return { type: "relation" as const, id, members, tags };
}

function convert(elements: OverpassElement[]) {
  return convertOSMToGeoJSON({ elements }).features;
}

describe("OSMToGeoJSONConverter", () => {
  it("converts a multipolygon relation with some tags on the lines to a Polygon", () => {
    const input = {
      version: 0.6,
      generator: "Overpass API 0.7.56.1002 b121d216",
      osm3s: {
        timestamp_osm_base: "2020-03-29T23:48:02Z",
        copyright:
          "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL.",
      },
      elements: [
        node(1, 0, 0),
        node(2, 0, 1),
        node(3, 1, 1),
        node(4, 2, 2),
        node(5, 2, 3),
        node(6, 3, 3),
        way(1001, [1, 2], {
          natural: "wood",
          source: "Kartverket N50",
          "source:date": "1989-07-01",
        }),
        way(1002, [2, 3, 1], {
          natural: "wood",
          source: "Kartverket N50",
          "source:date": "1989-07-01",
        }),
        way(1003, [4, 5, 6, 4], {
          natural: "wood",
          source: "Kartverket N50",
          "source:date": "1989-07-01",
          landuse: "winter_sports",
        }),
        relation(
          10001,
          [
            { type: "way", ref: 1001, role: "outer" },
            { type: "way", ref: 1002, role: "outer" },
            { type: "way", ref: 1003, role: "outer" },
          ],
          { landuse: "winter_sports", type: "multipolygon" },
        ),
      ],
    };

    expect(convertOSMToGeoJSON(input)).toMatchInlineSnapshot(`
      {
        "features": [
          {
            "geometry": {
              "coordinates": [
                [
                  [
                    [
                      2,
                      2,
                    ],
                    [
                      3,
                      3,
                    ],
                    [
                      2,
                      3,
                    ],
                    [
                      2,
                      2,
                    ],
                  ],
                ],
                [
                  [
                    [
                      0,
                      1,
                    ],
                    [
                      0,
                      0,
                    ],
                    [
                      1,
                      1,
                    ],
                    [
                      0,
                      1,
                    ],
                  ],
                ],
              ],
              "type": "MultiPolygon",
            },
            "id": "relation/10001",
            "properties": {
              "id": 10001,
              "tags": {
                "landuse": "winter_sports",
                "type": "multipolygon",
              },
              "type": "relation",
            },
            "type": "Feature",
          },
          {
            "geometry": {
              "coordinates": [
                [
                  [
                    2,
                    2,
                  ],
                  [
                    3,
                    3,
                  ],
                  [
                    2,
                    3,
                  ],
                  [
                    2,
                    2,
                  ],
                ],
              ],
              "type": "Polygon",
            },
            "id": "way/1003",
            "properties": {
              "id": 1003,
              "tags": {
                "landuse": "winter_sports",
                "natural": "wood",
                "source": "Kartverket N50",
                "source:date": "1989-07-01",
              },
              "type": "way",
            },
            "type": "Feature",
          },
          {
            "geometry": {
              "coordinates": [
                [
                  0,
                  0,
                ],
                [
                  0,
                  1,
                ],
              ],
              "type": "LineString",
            },
            "id": "way/1001",
            "properties": {
              "id": 1001,
              "tags": {
                "natural": "wood",
                "source": "Kartverket N50",
                "source:date": "1989-07-01",
              },
              "type": "way",
            },
            "type": "Feature",
          },
          {
            "geometry": {
              "coordinates": [
                [
                  0,
                  1,
                ],
                [
                  1,
                  1,
                ],
                [
                  0,
                  0,
                ],
              ],
              "type": "LineString",
            },
            "id": "way/1002",
            "properties": {
              "id": 1002,
              "tags": {
                "natural": "wood",
                "source": "Kartverket N50",
                "source:date": "1989-07-01",
              },
              "type": "way",
            },
            "type": "Feature",
          },
        ],
        "type": "FeatureCollection",
      }
    `);
  });

  it("converts closed ways to Polygons only when tagged as an area", () => {
    const features = convert([
      node(1, 0, 0),
      node(2, 0, 1),
      node(3, 1, 1),
      way(101, [1, 2, 3, 1], { "piste:type": "downhill" }),
      way(102, [1, 2, 3, 1], { "piste:type": "nordic" }),
      way(103, [1, 2, 3, 1], { "piste:type": "downhill", area: "no" }),
      way(104, [1, 2, 3, 1], { natural: "wood" }),
      way(105, [1, 2, 3], { "piste:type": "downhill" }),
    ]);

    expect(
      features.map((feature) => [feature.id, feature.geometry.type]),
    ).toEqual([
      ["way/101", "Polygon"],
      ["way/104", "Polygon"],
      ["way/102", "LineString"],
      ["way/103", "LineString"],
      ["way/105", "LineString"],
    ]);
  });

  it("joins the member ways of a route relation and keeps the ways themselves", () => {
    const features = convert([
      node(1, 0, 0),
      node(2, 1, 0),
      node(3, 2, 0),
      node(4, 5, 5),
      node(5, 6, 5),
      way(101, [1, 2], { "piste:type": "nordic" }),
      way(102, [2, 3]),
      way(103, [4, 5], { "piste:type": "nordic" }),
      relation(
        201,
        [
          { type: "way", ref: 101, role: "" },
          { type: "way", ref: 102, role: "" },
          { type: "way", ref: 103, role: "" },
        ],
        {
          type: "route",
          route: "piste",
          "piste:type": "nordic",
          name: "Loipe",
        },
      ),
      relation(
        202,
        [
          { type: "way", ref: 101, role: "" },
          { type: "way", ref: 102, role: "" },
        ],
        { type: "route", route: "piste", "piste:type": "nordic" },
      ),
    ]);

    expect(features).toEqual([
      {
        type: "Feature",
        id: "relation/201",
        properties: {
          type: "relation",
          id: 201,
          tags: {
            type: "route",
            route: "piste",
            "piste:type": "nordic",
            name: "Loipe",
          },
        },
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [5, 5],
              [6, 5],
            ],
            [
              [0, 0],
              [1, 0],
              [2, 0],
            ],
          ],
        },
      },
      {
        type: "Feature",
        id: "relation/202",
        properties: {
          type: "relation",
          id: 202,
          tags: { type: "route", route: "piste", "piste:type": "nordic" },
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        },
      },
      {
        type: "Feature",
        id: "way/101",
        properties: { type: "way", id: 101, tags: { "piste:type": "nordic" } },
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      },
      {
        type: "Feature",
        id: "way/102",
        properties: { type: "way", id: 102, tags: {} },
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 0],
            [2, 0],
          ],
        },
      },
      {
        type: "Feature",
        id: "way/103",
        properties: { type: "way", id: 103, tags: { "piste:type": "nordic" } },
        geometry: {
          type: "LineString",
          coordinates: [
            [5, 5],
            [6, 5],
          ],
        },
      },
    ]);
  });

  it("assembles a multipolygon with an inner ring following the right-hand rule", () => {
    const features = convert([
      node(1, 0, 0),
      node(2, 0, 1),
      node(3, 1, 1),
      node(4, 1, 0),
      node(5, 0.2, 0.2),
      node(6, 0.8, 0.2),
      node(7, 0.8, 0.8),
      node(8, 0.2, 0.8),
      // Outer ring drawn clockwise, split across two ways.
      way(101, [1, 2, 3]),
      way(102, [3, 4, 1]),
      // Inner ring drawn counterclockwise.
      way(103, [5, 6, 7, 8, 5]),
      relation(
        201,
        [
          { type: "way", ref: 101, role: "outer" },
          { type: "way", ref: 102, role: "outer" },
          { type: "way", ref: 103, role: "inner" },
        ],
        { type: "multipolygon", landuse: "winter_sports" },
      ),
    ]);

    expect(features[0]).toEqual({
      type: "Feature",
      id: "relation/201",
      properties: {
        type: "relation",
        id: 201,
        tags: { type: "multipolygon", landuse: "winter_sports" },
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1, 1],
            [0, 1],
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          [
            [0.2, 0.2],
            [0.2, 0.8],
            [0.8, 0.8],
            [0.8, 0.2],
            [0.2, 0.2],
          ],
        ],
      },
    });
    expect(
      features.slice(1).map((feature) => [feature.id, feature.geometry.type]),
    ).toEqual([
      ["way/101", "LineString"],
      ["way/102", "LineString"],
      ["way/103", "LineString"],
    ]);
  });

  it("emits points for tagged nodes, relation members and free nodes in ID order", () => {
    const features = convert([
      node(5, 5, 5),
      node(3, 3, 3, { "piste:dismount": "yes" }),
      node(1, 1, 1),
      node(2, 2, 2),
      node(4, 4, 4),
      way(101, [1, 2, 3], { "piste:type": "downhill" }),
      relation(201, [{ type: "node", ref: 5, role: "" }], {
        type: "site",
        site: "piste",
      }),
    ]);

    expect(features.map((feature) => feature.id)).toEqual([
      "way/101",
      "node/3",
      "node/4",
      "node/5",
    ]);
    expect(features[1]).toEqual({
      type: "Feature",
      id: "node/3",
      properties: {
        type: "node",
        id: 3,
        tags: { "piste:dismount": "yes" },
      },
      geometry: { type: "Point", coordinates: [3, 3] },
    });
    expect(features[2].properties.tags).toEqual({});
  });
});
