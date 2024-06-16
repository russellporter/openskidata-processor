import { convertOSMToGeoJSON } from "./OSMToGeoJSONConverter";

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
        {
          type: "node",
          id: 1,
          lat: 0,
          lon: 0,
        },
        {
          type: "node",
          id: 2,
          lat: 1,
          lon: 0,
        },
        {
          type: "node",
          id: 3,
          lat: 1,
          lon: 1,
        },
        {
          type: "node",
          id: 4,
          lat: 2,
          lon: 2,
        },
        {
          type: "node",
          id: 5,
          lat: 3,
          lon: 2,
        },
        {
          type: "node",
          id: 6,
          lat: 3,
          lon: 3,
        },
        {
          type: "way",
          id: 1001,
          nodes: [1, 2],
          tags: {
            natural: "wood",
            source: "Kartverket N50",
            "source:date": "1989-07-01",
          },
        },
        {
          type: "way",
          id: 1002,
          nodes: [2, 3, 1],
          tags: {
            natural: "wood",
            source: "Kartverket N50",
            "source:date": "1989-07-01",
          },
        },
        {
          type: "way",
          id: 1003,
          nodes: [4, 5, 6, 4],
          tags: {
            natural: "wood",
            source: "Kartverket N50",
            "source:date": "1989-07-01",
            landuse: "winter_sports",
          },
        },
        {
          type: "relation",
          id: 10001,
          members: [
            {
              type: "way",
              ref: 1001,
              role: "outer",
            },
            {
              type: "way",
              ref: 1002,
              role: "outer",
            },
            {
              type: "way",
              ref: 1003,
              role: "outer",
            },
          ],
          tags: {
            landuse: "winter_sports",
            type: "multipolygon",
          },
        },
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
              "meta": {},
              "relations": [],
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
              "meta": {},
              "relations": [
                {
                  "rel": 10001,
                  "reltags": {
                    "landuse": "winter_sports",
                    "type": "multipolygon",
                  },
                  "role": "outer",
                },
              ],
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
              "meta": {},
              "relations": [
                {
                  "rel": 10001,
                  "reltags": {
                    "landuse": "winter_sports",
                    "type": "multipolygon",
                  },
                  "role": "outer",
                },
              ],
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
              "meta": {},
              "relations": [
                {
                  "rel": 10001,
                  "reltags": {
                    "landuse": "winter_sports",
                    "type": "multipolygon",
                  },
                  "role": "outer",
                },
              ],
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
});
