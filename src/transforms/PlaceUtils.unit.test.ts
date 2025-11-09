import { Place } from "openskidata-format";
import { sortPlaces, uniquePlaces } from "./PlaceUtils";

describe("PlaceUtils", () => {
  describe("sortPlaces", () => {
    it("should sort places alphabetically by locality", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Vail",
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
      ];

      const sorted = sortPlaces(places);

      expect(sorted[0].localized.en.locality).toBe("Aspen");
      expect(sorted[1].localized.en.locality).toBe("Vail");
    });

    it("should sort places by region when localities are the same", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-VT",
          localized: {
            en: {
              country: "United States",
              region: "Vermont",
              locality: "Stowe",
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Stowe",
            },
          },
        },
      ];

      const sorted = sortPlaces(places);

      expect(sorted[0].localized.en.region).toBe("Colorado");
      expect(sorted[1].localized.en.region).toBe("Vermont");
    });

    it("should sort places by country when locality and region are the same", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "FR",
          iso3166_2: null,
          localized: {
            en: {
              country: "France",
              region: null,
              locality: null,
            },
          },
        },
        {
          iso3166_1Alpha2: "AT",
          iso3166_2: null,
          localized: {
            en: {
              country: "Austria",
              region: null,
              locality: null,
            },
          },
        },
      ];

      const sorted = sortPlaces(places);

      expect(sorted[0].localized.en.country).toBe("Austria");
      expect(sorted[1].localized.en.country).toBe("France");
    });

    it("should place null localities after non-null localities", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: null,
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
      ];

      const sorted = sortPlaces(places);

      expect(sorted[0].localized.en.locality).toBe("Aspen");
      expect(sorted[1].localized.en.locality).toBe(null);
    });

    it("should not mutate the original array", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Vail",
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
      ];

      const original = [...places];
      sortPlaces(places);

      expect(places).toEqual(original);
    });
  });

  describe("uniquePlaces", () => {
    it("should remove duplicate places", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
      ];

      const unique = uniquePlaces(places);

      expect(unique.length).toBe(1);
      expect(unique[0].localized.en.locality).toBe("Aspen");
    });

    it("should keep places with different localities", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Aspen",
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: "Vail",
            },
          },
        },
      ];

      const unique = uniquePlaces(places);

      expect(unique.length).toBe(2);
    });

    it("should keep places with different regions", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-CO",
          localized: {
            en: {
              country: "United States",
              region: "Colorado",
              locality: null,
            },
          },
        },
        {
          iso3166_1Alpha2: "US",
          iso3166_2: "US-VT",
          localized: {
            en: {
              country: "United States",
              region: "Vermont",
              locality: null,
            },
          },
        },
      ];

      const unique = uniquePlaces(places);

      expect(unique.length).toBe(2);
    });

    it("should keep places with different countries", () => {
      const places: Place[] = [
        {
          iso3166_1Alpha2: "US",
          iso3166_2: null,
          localized: {
            en: {
              country: "United States",
              region: null,
              locality: null,
            },
          },
        },
        {
          iso3166_1Alpha2: "CA",
          iso3166_2: null,
          localized: {
            en: {
              country: "Canada",
              region: null,
              locality: null,
            },
          },
        },
      ];

      const unique = uniquePlaces(places);

      expect(unique.length).toBe(2);
    });
  });
});
