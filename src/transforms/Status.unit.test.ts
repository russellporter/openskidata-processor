import getStatusAndValue from "./Status";

describe("getStatusAndValue", () => {
  it("uses operating status by default", () => {
    expect(getStatusAndValue("key", { key: "value" })).toMatchInlineSnapshot(`
      {
        "status": "operating",
        "value": "value",
      }
    `);
  });

  it("determines status from lifecycle prefix", () => {
    expect(getStatusAndValue("key", { "abandoned:key": "value" }))
      .toMatchInlineSnapshot(`
      {
        "status": "abandoned",
        "value": "value",
      }
    `);
  });

  it("determines status from lifecycle tag", () => {
    expect(getStatusAndValue("key", { key: "value", proposed: "yes" }))
      .toMatchInlineSnapshot(`
      {
        "status": "proposed",
        "value": "value",
      }
    `);
  });

  it("determines status from tag with lifecycle value", () => {
    expect(getStatusAndValue("key", { key: "proposed", proposed: "value" }))
      .toMatchInlineSnapshot(`
      {
        "status": "proposed",
        "value": "value",
      }
    `);
  });
});
