import { Activity, SourceType, Status } from "openskidata-format";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature
} from "../features/SkiAreaFeature";
import { formatSkiArea } from "./SkiAreaFormatter";

describe("SkiAreaFormatter", () => {
  it("formats OpenStreetMap ski area", () => {
    const feature: InputOpenStreetMapSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0]
          ]
        ]
      },
      properties: {
        id: "1",
        landuse: "winter_sports",
        name: "Ski Area",
        website: "http://example.com"
      }
    };

    expect(formatSkiArea(SourceType.OPENSTREETMAP)(feature))
      .toMatchInlineSnapshot(`
      Object {
        "geometry": Object {
          "coordinates": Array [
            Array [
              Array [
                0,
                0,
              ],
              Array [
                0,
                1,
              ],
              Array [
                1,
                0,
              ],
              Array [
                0,
                0,
              ],
            ],
          ],
          "type": "Polygon",
        },
        "properties": Object {
          "activities": Array [],
          "generated": false,
          "id": "2963e77902e033785a94e78f704b58025c05d02c",
          "name": "Ski Area",
          "runConvention": "europe",
          "sources": Array [
            Object {
              "id": "1",
              "type": "openstreetmap",
            },
          ],
          "status": "operating",
          "type": "skiArea",
          "website": "http://example.com",
        },
        "type": "Feature",
      }
    `);
  });

  it("formats status for abandoned OpenStreetMap ski area using lifecycle tagging", () => {
    const feature: InputOpenStreetMapSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0]
          ]
        ]
      },
      properties: {
        id: "1",
        "abandoned:landuse": "winter_sports"
      }
    };

    expect(
      formatSkiArea(SourceType.OPENSTREETMAP)(feature)?.properties.status
    ).toBe(Status.Abandoned);
  });

  it("formats status for abandoned OpenStreetMap ski area using multiple tags", () => {
    const feature: InputOpenStreetMapSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 0]
          ]
        ]
      },
      properties: {
        id: "1",
        landuse: "winter_sports",
        abandoned: "yes"
      }
    };

    expect(
      formatSkiArea(SourceType.OPENSTREETMAP)(feature)?.properties.status
    ).toBe(Status.Abandoned);
  });

  it("formats Skimap.org ski area", () => {
    const feature: InputSkiMapOrgSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [0, 0]
      },
      properties: {
        id: "1",
        name: "Ski Area",
        official_website: "http://example.com",
        scalerank: 1,
        activities: [Activity.Downhill],
        status: Status.Operating
      }
    };

    expect(formatSkiArea(SourceType.SKIMAP_ORG)(feature))
      .toMatchInlineSnapshot(`
      Object {
        "geometry": Object {
          "coordinates": Array [
            0,
            0,
          ],
          "type": "Point",
        },
        "properties": Object {
          "activities": Array [
            "downhill",
          ],
          "generated": false,
          "id": "7289533053d66d84ce0c5646af1988342508d22c",
          "name": "Ski Area",
          "runConvention": "europe",
          "sources": Array [
            Object {
              "id": "1",
              "type": "skimap.org",
            },
          ],
          "status": "operating",
          "type": "skiArea",
          "website": "http://example.com",
        },
        "type": "Feature",
      }
    `);
  });
});
