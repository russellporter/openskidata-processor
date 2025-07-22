import nock from "nock";
import { getPostgresTestConfig } from "../Config";
import Geocoder, { PhotonGeocode } from "./Geocoder";

const geocoderURL = "http://geocoder.example.com";

describe("Geocoder", () => {
  let geocoder: Geocoder;

  beforeEach(async () => {
    // Clear any existing cache data before each test to ensure clean state
    if (geocoder) {
      await geocoder.close();
    }
  });

  afterEach(async () => {
    if (geocoder) {
      await geocoder.close();
    }
  });

  async function setupDefaultGeocoder() {
    geocoder = new Geocoder(
      {
        url: geocoderURL + "/reverse",
        cacheTTL: 0,
      },
      getPostgresTestConfig(),
    );
    await geocoder.initialize();

    // Clear cache to ensure test isolation
    await (geocoder as any).diskCache.clear();

    return geocoder;
  }

  async function setupGeocoderWithTTL(ttl: number) {
    geocoder = new Geocoder(
      {
        url: geocoderURL + "/reverse",
        cacheTTL: ttl,
      },
      getPostgresTestConfig(),
    );
    await geocoder.initialize();

    // Clear cache to ensure test isolation
    await (geocoder as any).diskCache.clear();

    return geocoder;
  }
  it("caches in memory", async () => {
    let requestCount = 0;
    nock(geocoderURL)
      .get(
        "/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en&limit=1&radius=5",
      )
      .reply(200, () => {
        requestCount++;
        return mockPhotonGeocode("DE", undefined, undefined, undefined)
          .response;
      });

    geocoder = new Geocoder(
      {
        cacheTTL: 0,
        url: geocoderURL + "/reverse",
      },
      getPostgresTestConfig(),
    );

    await geocoder.initialize();

    // Clear cache to ensure test isolation
    await (geocoder as any).diskCache.clear();

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
      .get(
        "/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en&limit=1&radius=5",
      )
      .reply(200, () => {
        requestCount++;
        return mockPhotonGeocode("DE", undefined, undefined, undefined)
          .response;
      });

    await setupGeocoderWithTTL(60 * 1000);

    const result = await geocoder.geocode([0, 0]);

    expect(result).not.toBeNull();
    expect(requestCount).toBe(1);

    const secondResult = await geocoder.geocode([0, 0]);

    expect(secondResult).not.toBeNull();
    expect(requestCount).toBe(1);
  });

  it("handles geocode with no data", async () => {
    mockHTTPResponse(mockPhotonNoDataGeocode());
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("handles geocode with only country", async () => {
    mockHTTPResponse(mockPhotonGeocode("DE", undefined, undefined, undefined));
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "DE",
  "iso3166_2": null,
  "localized": {
    "en": {
      "country": "Germany",
      "locality": null,
      "region": null,
    },
  },
}
`);
  });

  it("handles geocode without city", async () => {
    mockHTTPResponse(
      mockPhotonGeocode(
        "DE",
        "Bavaria",
        "Landkreis Garmisch-Partenkirchen",
        undefined,
      ),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "DE",
  "iso3166_2": "DE-BY",
  "localized": {
    "en": {
      "country": "Germany",
      "locality": null,
      "region": "Bavaria",
    },
  },
}
`);
  });

  it("handles geocode", async () => {
    // https://photon.komoot.io/reverse?lon=11.2739&lat=47.4406&lang=en
    mockHTTPResponse(
      mockPhotonGeocode(
        "DE",
        "Bavaria",
        "Landkreis Garmisch-Partenkirchen",
        "Mittenwald",
      ),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "DE",
  "iso3166_2": "DE-BY",
  "localized": {
    "en": {
      "country": "Germany",
      "locality": "Mittenwald",
      "region": "Bavaria",
    },
  },
}
`);
  });

  it("can enhance a US geocode", async () => {
    // https://photon.komoot.io/reverse?lon=-120.238408&lat=39.154157&lang=en
    mockHTTPResponse(
      mockPhotonGeocode("US", "California", "Placer County", "Alpine Meadows"),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "US",
  "iso3166_2": "US-CA",
  "localized": {
    "en": {
      "country": "United States",
      "locality": "Alpine Meadows",
      "region": "California",
    },
  },
}
`);
  });

  it("can enhance a Kosovo geocode", async () => {
    // https://photon.komoot.io/reverse?lon=21.043023492030844&lat=42.17978924447299&lang=en
    mockHTTPResponse(
      mockPhotonGeocode(
        "XK",
        undefined,
        "District of Ferizaj",
        "Municipality of Štrpce",
      ),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "XK",
  "iso3166_2": null,
  "localized": {
    "en": {
      "country": "Kosovo",
      "locality": "Municipality of Štrpce",
      "region": null,
    },
  },
}
`);
  });

  it("can enhance a Czechia geocode", async () => {
    // https://photon.komoot.io/reverse?lon=15.51456&lat=50.68039&lang=en
    mockHTTPResponse(
      mockPhotonGeocode("CZ", "Northeast", "Liberec Region", "Vítkovice"),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "CZ",
  "iso3166_2": "CZ-LI",
  "localized": {
    "en": {
      "country": "Czech Republic",
      "locality": "Vítkovice",
      "region": "Liberec Region",
    },
  },
}
`);
  });

  it("can enhance a Japan geocode", async () => {
    // https://photon.komoot.io/reverse?lon=132.3609&lat=34.8246&lang=en
    mockHTTPResponse(
      mockPhotonGeocode("JP", "Shimane Prefecture", undefined, "Hamada"),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "JP",
  "iso3166_2": "JP-32",
  "localized": {
    "en": {
      "country": "Japan",
      "locality": "Hamada",
      "region": "Shimane Prefecture",
    },
  },
}
`);
  });

  it("does not geocode invalid country", async () => {
    mockHTTPResponse(
      mockPhotonGeocode("DEUS", undefined, undefined, undefined),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`null`);
  });

  it("does not geocode invalid region", async () => {
    mockHTTPResponse(
      mockPhotonGeocode("DE", "British Columbia", undefined, undefined),
    );
    await setupDefaultGeocoder();

    const result = await geocoder.geocode([0, 0]);
    expect(result).toMatchInlineSnapshot(`
{
  "iso3166_1Alpha2": "DE",
  "iso3166_2": null,
  "localized": {
    "en": {
      "country": "Germany",
      "locality": null,
      "region": null,
    },
  },
}
`);
  });
});

function mockHTTPResponse(geocode: PhotonGeocode) {
  nock(geocoderURL)
    .get(
      "/reverse?lon=-0.0054931640625&lat=-0.00274658203125&lang=en&limit=1&radius=5",
    )
    .reply(200, () => {
      return geocode.response;
    });
}

function mockPhotonNoDataGeocode(): PhotonGeocode {
  return {
    timestamp: 0,
    url: "",
    response: {
      type: "FeatureCollection",
      features: [],
    },
  };
}

function mockPhotonGeocode(
  countryCode: string | undefined,
  state: string | undefined,
  county: string | undefined,
  city: string | undefined,
): PhotonGeocode {
  return {
    timestamp: 0,
    url: "",
    response: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [0, 0],
          },
          properties: {
            countrycode: countryCode,
            state: state,
            county: county,
            city: city,
          },
        },
      ],
    },
  };
}
