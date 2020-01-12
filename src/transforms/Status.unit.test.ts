import getStatusAndValue from "./Status";

describe("getStatusAndValue", () => {
  it("uses operating status by default", () => {
    expect(getStatusAndValue("key", { key: "value" })).toMatchInlineSnapshot(`
      Object {
        "status": "operating",
        "value": "value",
      }
    `);
  });

  it("determines status from lifecycle prefix", () => {
    expect(getStatusAndValue("key", { "abandoned:key": "value" }))
      .toMatchInlineSnapshot(`
      Object {
        "status": "abandoned",
        "value": "value",
      }
    `);
  });

  it("determines status from lifecycle tag", () => {
    expect(getStatusAndValue("key", { key: "value", proposed: "yes" }))
      .toMatchInlineSnapshot(`
      Object {
        "status": "proposed",
        "value": "value",
      }
    `);
  });

  it("determines status from tag with lifecycle value", () => {
    expect(getStatusAndValue("key", { key: "proposed", proposed: "value" }))
      .toMatchInlineSnapshot(`
      Object {
        "status": "proposed",
        "value": "value",
      }
    `);
  });
});
