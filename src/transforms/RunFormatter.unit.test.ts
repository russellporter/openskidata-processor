import { InputRunFeature, InputRunProperties } from "../features/RunFeature";
import { formatRun } from "./RunFormatter";

describe("RunFormatter", () => {
  it("filters out runs with 'piste:abandoned' tag", () => {
    const run = formatRun(
      inputRun({ "piste:type": "downhill", "piste:abandoned": "yes" })
    );
    expect(run).toBeNull();
  });

  it("filters out runs with lifecycle prefix", () => {
    const run = formatRun(inputRun({ "proposed:piste:type": "downhill" }));
    expect(run).toBeNull();
  });

  it("formats simple run", () => {
    const run = formatRun(inputRun({ "piste:type": "downhill" }));
    expect(run!.properties).toMatchInlineSnapshot(`
      Object {
        "color": "hsl(298, 87%, 43%)",
        "colorName": "purple",
        "description": null,
        "difficulty": null,
        "gladed": null,
        "grooming": null,
        "id": "6fad61447505b84820d95342648edd841bdd4481",
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
    geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    properties: properties
  };
}
