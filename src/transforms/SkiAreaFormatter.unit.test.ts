import { Activity, SourceType, Status } from "openskidata-format";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature,
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
            [0, 0],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          landuse: "winter_sports",
          name: "Ski Area",
          website: "http://example.com",
        },
      },
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
          "id": "c638251d70817a3d3ad227cce5d353d3abff6abb",
          "location": null,
          "name": "Ski Area",
          "runConvention": "europe",
          "sources": Array [
            Object {
              "id": "way/1",
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
            [0, 0],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          "abandoned:landuse": "winter_sports",
        },
      },
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
            [0, 0],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          landuse: "winter_sports",
          abandoned: "yes",
        },
      },
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
        coordinates: [0, 0],
      },
      properties: {
        id: "1",
        name: "Ski Area",
        official_website: "http://example.com",
        scalerank: 1,
        activities: [Activity.Downhill],
        status: Status.Operating,
      },
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
          "id": "fde59eba834efdc0f8859c40c4211027d9b6e3e9",
          "location": null,
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
