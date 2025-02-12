import { Activity, Status } from "openskidata-format";
import {
  InputOpenStreetMapSkiAreaFeature,
  InputSkiMapOrgSkiAreaFeature,
  OSMSkiAreaSite,
} from "../features/SkiAreaFeature";
import { InputSkiAreaType, formatSkiArea } from "./SkiAreaFormatter";

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

    expect(formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(feature))
      .toMatchInlineSnapshot(`
{
  "geometry": {
    "coordinates": [
      [
        [
          0,
          0,
        ],
        [
          0,
          1,
        ],
        [
          1,
          0,
        ],
        [
          0,
          0,
        ],
      ],
    ],
    "type": "Polygon",
  },
  "properties": {
    "activities": [],
    "generated": false,
    "id": "c638251d70817a3d3ad227cce5d353d3abff6abb",
    "location": null,
    "name": "Ski Area",
    "runConvention": "europe",
    "sources": [
      {
        "id": "way/1",
        "type": "openstreetmap",
      },
    ],
    "status": "operating",
    "type": "skiArea",
    "websites": [
      "http://example.com",
    ],
    "wikidata_id": null,
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
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(feature)?.properties
        .status,
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
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(feature)?.properties
        .status,
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

    expect(formatSkiArea(InputSkiAreaType.SKIMAP_ORG)(feature))
      .toMatchInlineSnapshot(`
{
  "geometry": {
    "coordinates": [
      0,
      0,
    ],
    "type": "Point",
  },
  "properties": {
    "activities": [
      "downhill",
    ],
    "generated": false,
    "id": "fde59eba834efdc0f8859c40c4211027d9b6e3e9",
    "location": null,
    "name": "Ski Area",
    "runConvention": "europe",
    "sources": [
      {
        "id": "1",
        "type": "skimap.org",
      },
    ],
    "status": "operating",
    "type": "skiArea",
    "websites": [
      "http://example.com",
    ],
    "wikidata_id": null,
  },
  "type": "Feature",
}
`);
  });

  it("formats OpenStreetMap ski area site", () => {
    const site: OSMSkiAreaSite = {
      id: 1,
      type: "relation",
      members: [{ type: "way", ref: 1, role: "" }],
      tags: {
        name: "Wendelstein",
      },
    };

    expect(formatSkiArea(InputSkiAreaType.OPENSTREETMAP_SITE)(site))
      .toMatchInlineSnapshot(`
{
  "geometry": {
    "coordinates": [
      360,
      360,
      1,
    ],
    "type": "Point",
  },
  "properties": {
    "activities": [],
    "generated": false,
    "id": "2033ab9be8698fcd4794c24e42782bf33c124e8d",
    "location": null,
    "name": "Wendelstein",
    "runConvention": "north_america",
    "sources": [
      {
        "id": "relation/1",
        "type": "openstreetmap",
      },
    ],
    "status": "operating",
    "type": "skiArea",
    "websites": [],
    "wikidata_id": null,
  },
  "type": "Feature",
}
`);
  });

  it("uses localized names of site", () => {
    const site: OSMSkiAreaSite = {
      id: 1,
      type: "relation",
      members: [{ type: "way", ref: 1, role: "" }],
      tags: {
        name: "English",
        "name:fr": "French",
      },
    };

    expect(
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_SITE)(site)?.properties.name,
    ).toMatchInlineSnapshot(`"English, French"`);
  });

  it("de-duplicates names of site", () => {
    const site: OSMSkiAreaSite = {
      id: 1,
      type: "relation",
      members: [{ type: "way", ref: 1, role: "" }],
      tags: {
        name: "Wendelstein",
        "name:en": "Wendelstein",
      },
    };

    expect(
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_SITE)(site)?.properties.name,
    ).toMatchInlineSnapshot(`"Wendelstein"`);
  });

  it("uses localized names of landuse", () => {
    const feature: InputOpenStreetMapSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          landuse: "winter_sports",
          name: "English",
          "name:fr": "French",
        },
      },
    };

    expect(
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(feature)?.properties
        .name,
    ).toMatchInlineSnapshot(`"English, French"`);
  });

  it("de-duplicates names of landuse", () => {
    const feature: InputOpenStreetMapSkiAreaFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          landuse: "winter_sports",
          name: "English",
          "name:en": "English",
        },
      },
    };

    expect(
      formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE)(feature)?.properties
        .name,
    ).toMatchInlineSnapshot(`"English"`);
  });
});
