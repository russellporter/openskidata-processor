import nock from "nock";
import * as tmp from "tmp";
import Geocoder from "./Geocoder";

const geocoderURL = "http://geocoder.example.com";

describe("Geocoder", () => {
  it("caches in memory", async () => {
    let requestCount = 0;
    nock(geocoderURL)
      .get("/reverse?lon=-0.0054931640625&lat=-0.00274658203125")
      .reply(200, () => {
        requestCount++;
        return { country: "DE" };
      });

    const geocoder = new Geocoder({
      cacheDir: tmp.dirSync().name,
      diskTTL: 0,
      inMemoryCacheSize: 10,
      url: geocoderURL + "/reverse",
    });

    const result = await geocoder.geocode([0, 0]);

    expect(result).toEqual({ country: "DE" });
    expect(requestCount).toBe(1);

    const secondResult = await geocoder.geocode([0, 0]);

    expect(secondResult).toEqual({ country: "DE" });
    expect(requestCount).toBe(1);
  });

  it("caches on disk", async () => {
    let requestCount = 0;
    nock(geocoderURL)
      .get("/reverse?lon=-0.0054931640625&lat=-0.00274658203125")
      .reply(200, () => {
        requestCount++;
        return { country: "DE" };
      });

    const geocoder = new Geocoder({
      cacheDir: tmp.dirSync().name,
      diskTTL: 60 * 1000,
      inMemoryCacheSize: 0,
      url: geocoderURL + "/reverse",
    });

    const result = await geocoder.geocode([0, 0]);

    expect(result).toEqual({ country: "DE" });
    expect(requestCount).toBe(1);

    const secondResult = await geocoder.geocode([0, 0]);

    expect(secondResult).toEqual({ country: "DE" });
    expect(requestCount).toBe(1);
  });
});
