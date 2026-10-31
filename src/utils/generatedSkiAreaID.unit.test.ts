import { generatedSkiAreaID } from "./generatedSkiAreaID.js";

describe("generatedSkiAreaID", () => {
  it("is stable for the same member set", () => {
    const keys = ["run-b", "run-a", "lift-c"];
    expect(generatedSkiAreaID(keys)).toBe(generatedSkiAreaID(keys));
  });

  it("does not depend on the order the members were found in", () => {
    // The clustering traversal visits members in whatever order the flood fill
    // reaches them, so the ID must not encode that order.
    expect(generatedSkiAreaID(["a", "b", "c"])).toBe(
      generatedSkiAreaID(["c", "a", "b"]),
    );
  });

  it("distinguishes different member sets", () => {
    expect(generatedSkiAreaID(["a", "b"])).not.toBe(
      generatedSkiAreaID(["a", "b", "c"]),
    );
    expect(generatedSkiAreaID(["a"])).not.toBe(generatedSkiAreaID(["b"]));
  });

  it("does not confuse a different grouping of the same characters", () => {
    // A naive concatenation without a separator would collide these two.
    expect(generatedSkiAreaID(["ab", "c"])).not.toBe(
      generatedSkiAreaID(["a", "bc"]),
    );
  });

  it("produces a version 5 UUID, keeping the shape the random IDs had", () => {
    const id = generatedSkiAreaID(["run-1", "run-2"]);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("pins a known value, so the IDs in the output cannot drift silently", () => {
    // Changing this expectation renames every generated ski area in the published
    // dataset. Do not update it without intending that.
    expect(generatedSkiAreaID(["run-1", "run-2"])).toMatchInlineSnapshot(
      `"6e75fa6e-cbd1-5334-9f31-2f729bc44e06"`,
    );
  });

  it("rejects an empty member set rather than inventing an ID", () => {
    expect(() => generatedSkiAreaID([])).toThrow(
      "Cannot derive a ski area ID from an empty member set",
    );
  });
});
