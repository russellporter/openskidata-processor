import { RunGrooming, RunUse } from "openskidata-format";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties";
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
      }),
    );
    expect(run).toBeNull();
  });

  it("filters out runs with lifecycle prefix", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: { "proposed:piste:type": "downhill" },
      }),
    );
    expect(run).toBeNull();
  });

  it("formats simple run", () => {
    const run = formatRun(
      inputRun({ type: "way", id: 1, tags: { "piste:type": "downhill" } }),
    );
    expect(run!.properties).toMatchInlineSnapshot(`
{
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
  "wikidata_id": null,
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
      }),
    );
    expect(run!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la piste, Run name"`,
    );
  });

  it("de-duplicates names", () => {
    const run = formatRun(
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
    expect(run!.properties.name).toMatchInlineSnapshot(`"Run name"`);
  });

  it("adds oneway to downhill run if not specified", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
        },
      }),
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
      }),
    );
    expect(run!.properties.oneway).toBe(false);
  });

  it("distinguishes gladed run", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          gladed: "yes",
        },
      }),
    );
    expect(run!.properties.gladed).toBe(true);
  });

  it("distinguishes forested run as gladed", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          landuse: "forest",
        },
      }),
    );
    expect(run!.properties.gladed).toBe(true);
  });

  it("distinguishes wooded run as gladed", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          natural: "wood",
        },
      }),
    );
    expect(run!.properties.gladed).toBe(true);
  });

  it("gives gladed tag precedence over woods tag", () => {
    const run = formatRun(
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
    expect(run!.properties.gladed).toBe(false);
  });

  it("normalizes piste:grooming=no to backcountry", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "downhill",
          "piste:grooming": "no",
        },
      }),
    );
    expect(run!.properties.grooming).toBe(RunGrooming.Backcountry);
  });

  it("supports nordic trails tagged as classic;skating", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(run!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports nordic trails tagged as skating;classic", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(run!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports nordic trails tagged as classic+skating", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "nordic",
          "piste:grooming": "classic;skating",
        },
      }),
    );
    expect(run!.properties.grooming).toBe(RunGrooming.ClassicAndSkating);
  });

  it("supports fatbike trails", () => {
    const run = formatRun(
      inputRun({
        type: "way",
        id: 1,
        tags: {
          "piste:type": "fatbike",
        },
      }),
    );
    expect(run!.properties.uses).toEqual([RunUse.Fatbike]);
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
    ).toBeNull();

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
    ).toBeNull();
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
