import { InputRunFeature, InputRunProperties } from "../features/RunFeature";
import { formatRun } from "./RunFormatter";

describe("RunFormatter", () => {
  it("filters out runs with 'piste:abandoned' tag", () => {
    const run = formatRun(
      inputRun({
        id: "way/1",
        "piste:type": "downhill",
        "piste:abandoned": "yes"
      })
    );
    expect(run).toBeNull();
  });

  it("filters out runs with lifecycle prefix", () => {
    const run = formatRun(
      inputRun({ id: "way/1", "proposed:piste:type": "downhill" })
    );
    expect(run).toBeNull();
  });

  it("formats simple run", () => {
    const run = formatRun(inputRun({ id: "way/1", "piste:type": "downhill" }));
    expect(run!.properties).toMatchInlineSnapshot(`
      Object {
        "color": "hsl(0, 0%, 65%)",
        "colorName": "grey",
        "description": null,
        "difficulty": null,
        "gladed": null,
        "grooming": null,
        "id": "9e9439e791c9dbdde8298c6e9f7c09f4b7e00ccd",
        "lit": null,
        "name": null,
        "oneway": null,
        "patrolled": null,
        "ref": null,
        "skiAreas": Array [],
        "status": "operating",
        "type": "run",
        "uses": Array [
          "downhill",
        ],
      }
    `);
  });
});

function inputRun(properties: InputRunProperties): InputRunFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: properties
  };
}
