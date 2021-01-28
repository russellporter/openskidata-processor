import { InputRunFeature, OSMRunTags } from "../features/RunFeature";
import { formatRun } from "./RunFormatter";

describe("RunFormatter", () => {
  it("filters out runs with 'piste:abandoned' tag", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:abandoned": "yes",
        },
      })
    );
    expect(run).toBeNull();
  });

  it("filters out runs with lifecycle prefix", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: { "proposed:piste:type": "downhill" },
      })
    );
    expect(run).toBeNull();
  });

  it("formats simple run", () => {
    const run = formatRun(
      inputRun({ type: "way", id: 1, tags: { "piste:type": "downhill" } })
    );
    expect(run!.properties).toMatchInlineSnapshot(`
      Object {
        "color": "hsl(0, 0%, 35%)",
        "colorName": "grey",
        "convention": "europe",
        "description": null,
        "difficulty": null,
        "gladed": null,
        "grooming": null,
        "id": "64e1be16905be0666594b5c433d4aa1aa1a64e5f",
        "lit": null,
        "location": null,
        "name": null,
        "oneway": true,
        "patrolled": null,
        "ref": null,
        "skiAreas": Array [],
        "sources": Array [
          Object {
            "id": "way/1",
            "type": "openstreetmap",
          },
        ],
        "status": "operating",
        "type": "run",
        "uses": Array [
          "downhill",
        ],
      }
    `);
  });

  it("uses piste name instead of other name", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:name": "🇫🇷 Nom de la piste",
          "piste:name:en": "Run name",
          name: "Name that shouldn't be shown",
        },
      })
    );
    expect(run!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la piste, Run name"`
    );
  });

  it("adds oneway to downhill run if not specified", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
        },
      })
    );
    expect(run!.properties.oneway).toBe(true);
  });

  it("preserves oneway value of bidirectional downhill run", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          oneway: "no",
        },
      })
    );
    expect(run!.properties.oneway).toBe(false);
  });
});

function inputRun(
  properties: OSMGeoJSONProperties<OSMRunTags>
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
