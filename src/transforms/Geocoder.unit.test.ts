import nock from "nock";
import * as tmp from "tmp";
import Geocoder, { PhotonGeocode } from "./Geocoder";

const geocoderURL = "http://geocoder.example.com";

describe("Geocoder", () => {
  it("caches in memory", async () => {
    let requestCount = 0;
    nock(geocoderURL)
      .get("/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en")
      .reply(200, () => {
        requestCount++;
        return mockPhotonGeocode("Germany", undefined, undefined);
      });

    const geocoder = new Geocoder({
      cacheDir: tmp.dirSync().name,
      diskTTL: 0,
      inMemoryCacheSize: 10,
      url: geocoderURL + "/reverse",
    });

    const result = await geocoder.geocode([0, 0]);

    expect(result).not.toBeNull();
    expect(requestCount).toBe(1);

    const secondResult = await geocoder.geocode([0, 0]);

    expect(secondResult).not.toBeNull();
    expect(requestCount).toBe(1);
  });

  it("caches on disk", async () => {
    let requestCount = 0;
    nock(geocoderURL)
      .get("/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en")
      .reply(200, () => {
        requestCount++;
        return mockPhotonGeocode("Germany", undefined, undefined);
      });

    const geocoder = new Geocoder({
      cacheDir: tmp.dirSync().name,
      diskTTL: 60 * 1000,
      inMemoryCacheSize: 0,
      url: geocoderURL + "/reverse",
    });

    const result = await geocoder.geocode([0, 0]);

    expect(result).not.toBeNull();
    expect(requestCount).toBe(1);

    const secondResult = await geocoder.geocode([0, 0]);

    expect(secondResult).not.toBeNull();
    expect(requestCount).toBe(1);
  });

  it("handles geocode with no data", async () => {
    mockHTTPResponse(mockPhotonNoDataGeocode());

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("handles geocode with only country", async () => {
    mockHTTPResponse(mockPhotonGeocode("Germany", undefined, undefined));

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`
      Object {
        "iso3166_1Alpha2": "DE",
        "iso3166_2": null,
        "localized": Object {
          "en": Object {
            "country": "Germany",
            "locality": null,
            "region": null,
          },
        },
      }
    `);
  });

  it("handles geocode without city", async () => {
    mockHTTPResponse(mockPhotonGeocode("Germany", "Bavaria", undefined));

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`
      Object {
        "iso3166_1Alpha2": "DE",
        "iso3166_2": "DE-BY",
        "localized": Object {
          "en": Object {
            "country": "Germany",
            "locality": null,
            "region": "Bavaria",
          },
        },
      }
    `);
  });

  it("handles geocode", async () => {
    mockHTTPResponse(mockPhotonGeocode("Germany", "Bavaria", "Mittenwald"));

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`
      Object {
        "iso3166_1Alpha2": "DE",
        "iso3166_2": "DE-BY",
        "localized": Object {
          "en": Object {
            "country": "Germany",
            "locality": "Mittenwald",
            "region": "Bavaria",
          },
        },
      }
    `);
  });

  it("can enhance a US geocode", async () => {
    mockHTTPResponse(
      mockPhotonGeocode(
        "United States of America",
        "California",
        "Alpine Meadows"
      )
    );

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`
      Object {
        "iso3166_1Alpha2": "US",
        "iso3166_2": "US-CA",
        "localized": Object {
          "en": Object {
            "country": "United States",
            "locality": "Alpine Meadows",
            "region": "California",
          },
        },
      }
    `);
  });

  it("does not geocode invalid country", async () => {
    mockHTTPResponse(mockPhotonGeocode("German", undefined, undefined));

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("does not geocode invalid region", async () => {
    mockHTTPResponse(
      mockPhotonGeocode("Germany", "British Columbia", undefined)
    );

    const result = await defaultGeocoder().geocode([0, 0]);

    expect(result).toMatchInlineSnapshot(`
      Object {
        "iso3166_1Alpha2": "DE",
        "iso3166_2": null,
        "localized": Object {
          "en": Object {
            "country": "Germany",
            "locality": null,
            "region": null,
          },
        },
      }
    `);
  });
});

function defaultGeocoder() {
  return new Geocoder({
    url: geocoderURL + "/reverse",
    cacheDir: tmp.dirSync().name,
    diskTTL: 0,
    inMemoryCacheSize: 0,
  });
}

function mockHTTPResponse(geocode: PhotonGeocode) {
  nock(geocoderURL)
    .get("/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en")
    .reply(200, () => {
      return geocode;
    });
}

function mockPhotonNoDataGeocode(): PhotonGeocode {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function mockPhotonGeocode(
  country: string | undefined,
  state: string | undefined,
  city: string | undefined
): PhotonGeocode {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [0, 0],
        },
        properties: {
          country: country,
          state: state,
          city: city,
        },
      },
    ],
  };
}
