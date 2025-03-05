import { getOSMName } from "./OSMTransforms";

type TestProperties = Record<string, string | undefined>;

describe("OSMTransforms", () => {
  describe("getOSMName", () => {
    it("should return null when no name is found", () => {
      const properties: TestProperties = {};
      expect(getOSMName(properties, "name")).toBeNull();
    });

    it("should return the name when one exists", () => {
      const properties: TestProperties = { name: "Test Chair" };
      expect(getOSMName(properties, "name")).toBe("Test Chair");
    });

    it("should use fallback key when primary key is not found", () => {
      const properties: TestProperties = { fallback: "Fallback Name" };
      expect(getOSMName<TestProperties>(properties, "name", "fallback")).toBe(
        "Fallback Name",
      );
    });

    it("should return multiple localized names joined with comma", () => {
      const properties: TestProperties = {
        name: "Test Chair",
        "name:en": "English Name",
        "name:fr": "French Name",
      };
      expect(getOSMName(properties, "name")).toBe(
        "Test Chair, English Name, French Name",
      );
    });

    it("should remove ref prefix with dash when name starts with ref", () => {
      const properties: TestProperties = { name: "11 - Peak Chair" };
      expect(getOSMName(properties, "name", null, "11")).toBe("Peak Chair");
    });

    it("should remove ref prefix with space when name starts with ref", () => {
      const properties: TestProperties = { name: "11 Peak Chair" };
      expect(getOSMName(properties, "name", null, "11")).toBe("Peak Chair");
    });

    it("should not modify name when ref is not at beginning", () => {
      const properties: TestProperties = { name: "Peak Chair 11" };
      expect(getOSMName(properties, "name", null, "11")).toBe("Peak Chair 11");
    });

    it("should not modify name when ref is null", () => {
      const properties: TestProperties = { name: "11 Peak Chair" };
      expect(getOSMName(properties, "name")).toBe("11 Peak Chair");
    });

    it("should not modify name when ref doesn't match beginning", () => {
      const properties: TestProperties = { name: "11 Peak Chair" };
      expect(getOSMName(properties, "name", null, "12")).toBe("11 Peak Chair");
    });

    it("should remove ref prefix with dash and no space when name starts with ref", () => {
      const properties: TestProperties = { name: "11-Peak Chair" };
      expect(getOSMName(properties, "name", null, "11")).toBe("Peak Chair");
    });

    it("should not remove ref prefix with no space and no dash when name starts with ref", () => {
      const properties: TestProperties = { name: "Peak Chair" };
      expect(getOSMName(properties, "name", null, "P")).toBe("Peak Chair");
    });

    it("should handle names with multiple spaces after ref", () => {
      const properties: TestProperties = { name: "11   Peak Chair" };
      expect(getOSMName(properties, "name", null, "11")).toBe("Peak Chair");
    });
  });
});
