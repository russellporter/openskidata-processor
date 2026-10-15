import { vi } from "vitest";
import { configFromEnvironment } from "./Config.js";

beforeEach(() => {
  vi.stubEnv("BBOX", "");
  vi.stubEnv("OSM_INPUT_DIR", "");
});

afterEach(() => vi.unstubAllEnvs());

it("defaults to downloading OSM data", () => {
  expect(configFromEnvironment().osmInputDir).toBeNull();
});

it("reads the local OSM input directory from the environment", () => {
  vi.stubEnv("OSM_INPUT_DIR", "/app/osm-input");
  expect(configFromEnvironment().osmInputDir).toBe("/app/osm-input");
});

it("rejects BBOX together with local OSM input", () => {
  vi.stubEnv("OSM_INPUT_DIR", "/app/osm-input");
  vi.stubEnv("BBOX", "[132.34,34.78,132.40,34.84]");
  expect(configFromEnvironment).toThrow(
    "BBOX can't be combined with OSM_INPUT_DIR",
  );
});
