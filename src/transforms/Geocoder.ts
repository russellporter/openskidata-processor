import { Mutex } from "async-mutex";
import DataLoader from "dataloader";
import fetchRetry from "fetch-retry";
import * as iso3166_2 from "iso3166-2-db";
import { Region } from "iso3166-2-db";
import * as ngeohash from "ngeohash";
import * as Config from "../Config";
import { PostgresCache } from "../utils/PostgresCache";

export type PhotonGeocode = {
  url: string;
  timestamp: number;
  response: GeoJSON.FeatureCollection<
    GeoJSON.Geometry,
    {
      country?: string;
      countrycode?: string;
      state?: string;
      county?: string;
      city?: string;
    }
  >;
};

export type WhosOnFirstGeometry = {
  id: number;
  name: string;
  placetype: string;
  iso_code?: string;
  name_eng?: string;
};

export type GeocodeApiResponse = {
  url: string;
  timestamp: number;
  response: {
    geometries: WhosOnFirstGeometry[];
  };
};

export type RawGeocode = PhotonGeocode | GeocodeApiResponse;

export type Geocode = {
  iso3166_1Alpha2: string;
  iso3166_2: string | null;
  localized: {
    en: {
      country: string;
      region: string | null;
      locality: string | null;
    };
  };
};

// Precision of +-0.61km
const geocodePrecision = 6;

iso3166_2.changeNameProvider("osm");

export default class Geocoder {
  private config: Config.GeocodingServerConfig;
  private geocodingType: Config.GeocodingServerType;
  private loader: DataLoader<string, RawGeocode>;
  private remoteErrorCount = 0;
  private maxRemoteErrors = 10;
  private mutex = new Mutex();
  private diskCache: PostgresCache<RawGeocode>;

  constructor(
    config: Config.GeocodingServerConfig,
    postgresConfig: Config.PostgresConfig,
  ) {
    this.config = config;
    this.geocodingType = config.type || 'photon';

    // Initialize PostgreSQL disk cache with type-specific table name
    // Replace hyphens with underscores for PostgreSQL compatibility
    const sanitizedType = this.geocodingType.replace(/-/g, '_');
    this.diskCache = new PostgresCache<RawGeocode>(
      `geocoding_${sanitizedType}`,
      postgresConfig,
      config.cacheTTL,
    );

    this.loader = new DataLoader<string, RawGeocode>(
      async (loadForKeys) => {
        return [await this.rawGeocodeLocalOrRemote(loadForKeys[0])];
      },
      {
        batch: false,
      },
    );
  }

  async initialize(): Promise<void> {
    await this.diskCache.initialize();
  }

  async close(): Promise<void> {
    await this.diskCache.close();
  }

  geocode = async (position: GeoJSON.Position): Promise<Geocode | null> => {
    const rawGeocode = await this.rawGeocode(position);
    return this.enhance(rawGeocode);
  };

  rawGeocode = async (position: GeoJSON.Position): Promise<RawGeocode> => {
    const geohash = ngeohash.encode(position[1], position[0], geocodePrecision);

    return await this.loader.load(geohash);
  };

  private rawGeocodeLocalOrRemote = async (
    geohash: string,
  ): Promise<RawGeocode> => {
    try {
      const content = await this.rawGeocodeLocal(geohash);
      if (content) {
        return content;
      }
    } catch (error) {
      console.warn(`Local cache lookup failed for ${geohash}:`, error);
    }

    if (this.remoteErrorCount >= this.maxRemoteErrors) {
      throw new Error("Too many errors, not trying remote");
    }

    try {
      return await this.rawGeocodeRemote(geohash);
    } catch (error) {
      this.remoteErrorCount++;
      throw error;
    }
  };

  private rawGeocodeLocal = async (
    geohash: string,
  ): Promise<RawGeocode | null> => {
    return await this.diskCache.get(geohash);
  };

  private rawGeocodeRemote = async (
    geohash: string,
  ): Promise<RawGeocode> => {
    return this.mutex.runExclusive(async () => {
      const point = ngeohash.decode(geohash);

      let url: string;
      if (this.geocodingType === 'geocode-api') {
        url = `${this.config.url}?lon=${point.longitude}&lat=${point.latitude}&fields=id,name,placetype,iso_code,name_eng`;
      } else {
        url = `${this.config.url}?lon=${point.longitude}&lat=${point.latitude}&lang=en&limit=1&radius=5`;
      }

      let fetchResponse: Response;
      try {
        fetchResponse = await fetchRetry(fetch)(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          retryDelay: 10000,
          retryOn: (attempt, error, response) => {
            if (attempt > 1) {
              return false;
            }
            if (error !== null) {
              console.error(`Geocoding request failed (attempt ${attempt}):`, error);
              return true;
            }
            if (response !== null && (response.status < 200 || response.status >= 300)) {
              console.error(`Geocoding request failed with status ${response.status} (attempt ${attempt}): ${url}`);
              return true;
            }
            return false;
          },
        });
      } catch (error) {
        console.error(`Geocoding fetch failed for ${url}:`, error);
        throw error;
      }

      if (!fetchResponse.ok) {
        const errorMessage = `Geocoding request failed with status ${fetchResponse.status} for ${url}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }

      let response: any;
      try {
        response = await fetchResponse.json();
      } catch (error) {
        console.error(`Failed to parse JSON response from ${url}:`, error);
        throw error;
      }

      const data: RawGeocode = {
        url: url,
        response: response,
        timestamp: currentTimestamp(),
      };

      await this.diskCache.set(geohash, data);
      return data;
    });
  };

  private enhancePhoton = (rawGeocode: PhotonGeocode): Geocode | null => {
    console.assert(
      rawGeocode.response.features.length <= 1,
      "Expected Photon geocode to only have at most a single feature.",
    );
    if (rawGeocode.response.features.length === 0) {
      return null;
    }

    const properties = rawGeocode.response.features[0].properties;
    if (!properties.countrycode) {
      return null;
    }

    const country = iso3166_2.getDataSet()[properties.countrycode];

    if (!country && properties.countrycode === "XK") {
      // Kosovo is not in the iso3166-2-db dataset
      return {
        iso3166_1Alpha2: "XK",
        iso3166_2: null,
        localized: {
          en: {
            country: "Kosovo",
            region: null,
            locality: properties.city || null,
          },
        },
      };
    }

    if (!country) {
      console.log(
        `Could not find country info for code ${properties.countrycode}`,
      );
      return null;
    }

    let region: Region | null = null;

    if (properties.state !== undefined) {
      region =
        country.regions.find(
          (region: Region) => region.name === properties.state,
        ) || null;
    }

    if (region === null && properties.county !== undefined) {
      region =
        country.regions.find(
          (region: Region) => region.name === properties.county,
        ) || null;
    }

    return {
      iso3166_1Alpha2: country.iso,
      iso3166_2: region ? country.iso + "-" + region.iso : null,
      localized: {
        en: {
          country: country.names.en,
          region: region?.name || null,
          locality: properties.city || null,
        },
      },
    };
  };

  private enhanceWhosOnFirst = (rawGeocode: GeocodeApiResponse): Geocode | null => {
    const geometries = rawGeocode.response.geometries;

    if (geometries.length === 0) {
      return null;
    }

    // Find country, region, and locality from geometries
    const countryGeometry = geometries.find(g => g.placetype === 'country');
    const regionGeometry = geometries.find(g => g.placetype === 'region');
    const localityGeometry = geometries.find(g => g.placetype === 'locality');

    // Must have at least a country
    if (!countryGeometry) {
      return null;
    }

    // Get country code from iso_code
    const countryCode = countryGeometry.iso_code;
    if (!countryCode) {
      return null;
    }

    // Get ISO 3166-2 code from region if available
    const iso3166_2 = regionGeometry?.iso_code || null;

    return {
      iso3166_1Alpha2: countryCode,
      iso3166_2: iso3166_2,
      localized: {
        en: {
          country: countryGeometry.name_eng || countryGeometry.name,
          region: regionGeometry?.name_eng || regionGeometry?.name || null,
          locality: localityGeometry?.name_eng || localityGeometry?.name || null,
        },
      },
    };
  };

  private enhance = (rawGeocode: RawGeocode): Geocode | null => {
    if (this.geocodingType === 'geocode-api') {
      return this.enhanceWhosOnFirst(rawGeocode as GeocodeApiResponse);
    } else {
      return this.enhancePhoton(rawGeocode as PhotonGeocode);
    }
  };
}

function currentTimestamp() {
  return new Date().valueOf();
}
