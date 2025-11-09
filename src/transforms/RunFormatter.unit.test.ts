import { RunGrooming, RunUse } from "openskidata-format";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties";
import { InputRunFeature, OSMRunTags } from "../features/RunFeature";
import { formatRun } from "./RunFormatter";

describe("RunFormatter", () => {
  it("filters out runs with 'piste:abandoned' tag", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:abandoned": "yes",
        },
      }),
    );
    expect(runs).toEqual([]);
  });

  it("filters out runs with lifecycle prefix", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: { "proposed:piste:type": "downhill" },
      }),
    );
    expect(runs).toEqual([]);
  });

  it("formats simple run", () => {
    const runs = formatRun(
      inputRun({ type: "way", id: 1, tags: { "piste:type": "downhill" } }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties).toMatchInlineSnapshot(`
{
  "description": null,
  "difficulty": null,
  "difficultyConvention": "europe",
  "elevationProfile": null,
  "gladed": null,
  "grooming": null,
  "id": "64e1be16905be0666594b5c433d4aa1aa1a64e5f",
  "lit": null,
  "name": null,
  "oneway": true,
  "patrolled": null,
  "places": [],
  "ref": null,
  "skiAreas": [],
  "sources": [
    {
      "id": "way/1",
      "type": "openstreetmap",
    },
  ],
  "status": "operating",
  "type": "run",
  "uses": [
    "downhill",
  ],
  "websites": [],
  "wikidataID": null,
}
`);
  });

  it("uses piste name instead of other name", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:name": "🇫🇷 Nom de la piste",
          "piste:name:en": "Run name",
          name: "Name that shouldn't be shown",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la piste, Run name"`,
    );
  });

  it("de-duplicates names", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          name: "Run name",
          "name:en": "Run name",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.name).toMatchInlineSnapshot(`"Run name"`);
  });

  it("adds oneway to downhill run if not specified", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.oneway).toBe(true);
  });

  it("preserves oneway value of bidirectional downhill run", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          oneway: "no",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.oneway).toBe(false);
  });

  it("distinguishes gladed run", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          gladed: "yes",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.gladed).toBe(true);
  });

  it("distinguishes forested run as gladed", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          landuse: "forest",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.gladed).toBe(true);
  });

  it("distinguishes wooded run as gladed", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          natural: "wood",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.gladed).toBe(true);
  });

  it("gives gladed tag precedence over woods tag", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          natural: "wood",
          gladed: "no",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.gladed).toBe(false);
  });

  it("normalizes piste:grooming=no to backcountry", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:grooming": "no",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.grooming).toBe(RunGrooming.Backcountry);
  });

  it("supports nordic trails tagged as classic;skating", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports nordic trails tagged as skating;classic", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports nordic trails tagged as classic+skating", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports fatbike trails", () => {
    const runs = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "fatbike",
        },
      }),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.properties.uses).toEqual([RunUse.Fatbike]);
  });

  it("drops run with unsupported status", () => {
    expect(
      formatRun(
        inputRun({
          type: "way",
          id: 1,
          tags: {
            "piste:type": "downhill",
            demolished: "yes",
          },
        }),
      ),
    ).toEqual([]);

    expect(
      formatRun(
        inputRun({
          type: "way",
          id: 1,
          tags: {
            "piste:type": "demolished",
            demolished: "downhill",
          },
        }),
      ),
    ).toEqual([]);
  });

  it("splits MultiPolygon runs into separate Polygon features", () => {
    const multiPolygonFeature: InputRunFeature = {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          // First polygon
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
          // Second polygon
          [
            [
              [2, 2],
              [3, 2],
              [3, 3],
              [2, 3],
              [2, 2],
            ],
          ],
        ],
      },
      properties: {
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          name: "Multi-part run",
        },
      },
    };

    const runs = formatRun(multiPolygonFeature);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.geometry.type).toBe("Polygon");
    expect(runs[1]!.geometry.type).toBe("Polygon");
    expect(runs[0]!.properties.name).toBe("Multi-part run");
    expect(runs[1]!.properties.name).toBe("Multi-part run");
  });

  it("splits MultiLineString run from OSM relation into separate LineString features", () => {
    const multiLineStringFeature: InputRunFeature = {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [2, 2],
            [3, 3],
          ],
        ],
      },
      properties: {
        type: "relation",
        id: 12345,
        tags: {
          "piste:type": "nordic",
          name: "Nordic Trail",
          route: "piste",
          type: "route",
        },
      },
    };

    const runs = formatRun(multiLineStringFeature);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.geometry.type === "LineString")).toBe(true);
  });
});

function inputRun(
  properties: OSMGeoJSONProperties<OSMRunTags>,
): InputRunFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: properties,
  };
}
