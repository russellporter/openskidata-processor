import { Mutex } from "async-mutex";
import DataLoader from "dataloader";
import fetchRetry from "fetch-retry";
import * as iso3166_2 from "iso3166-2-db";
import { Region } from "iso3166-2-db";
import { LRUMap } from "lru_map";
import * as ngeohash from "ngeohash";
import path from "path";
import * as Config from "../Config";
import { SQLiteCache } from "../utils/SQLiteCache";

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
  private loader: DataLoader<string, PhotonGeocode>;
  private remoteErrorCount = 0;
  private maxRemoteErrors = 10;
  private mutex = new Mutex();
  private diskCache: SQLiteCache<PhotonGeocode>;

  constructor(config: Config.GeocodingServerConfig) {
    this.config = config;
    
    // Initialize SQLite disk cache
    const cacheFile = path.join(config.cacheDir, "geocode.db");
    this.diskCache = new SQLiteCache<PhotonGeocode>(cacheFile, config.diskTTL);
    
    this.loader = new DataLoader<string, PhotonGeocode>(
      async (loadForKeys) => {
        return [await this.rawGeocodeLocalOrRemote(loadForKeys[0])];
      },
      {
        batch: false,
        cacheMap: new LRUMap(config.inMemoryCacheSize),
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

  rawGeocode = async (position: GeoJSON.Position): Promise<PhotonGeocode> => {
    const geohash = ngeohash.encode(position[1], position[0], geocodePrecision);

    return await this.loader.load(geohash);
  };

  private rawGeocodeLocalOrRemote = async (
    geohash: string,
  ): Promise<PhotonGeocode> => {
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

  private rawGeocodeLocal = async (geohash: string): Promise<PhotonGeocode | null> => {
    return await this.diskCache.get(cacheKey(geohash));
  };

  private rawGeocodeRemote = async (
    geohash: string,
  ): Promise<PhotonGeocode> => {
    return this.mutex.runExclusive(async () => {
      const point = ngeohash.decode(geohash);
      const url = `${this.config.url}?lon=${point.longitude}&lat=${point.latitude}&lang=en&limit=1&radius=5`;
      const response = await fetchRetry(fetch)(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        retryDelay: 10000,
        retryOn: (attempt, error, response) => {
          if (attempt > 1) {
            return false;
          }
          return (
            error !== null || (response !== null && response.status >= 400)
          );
        },
      }).then((res) => res.json());

      const data: PhotonGeocode = {
        url: url,
        response: response,
        timestamp: currentTimestamp(),
      };

      await this.diskCache.set(cacheKey(geohash), data);
      return data;
    });
  };

  private enhance = (rawGeocode: PhotonGeocode): Geocode | null => {
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
}

function cacheKey(geohash: string) {
  return "geocode/" + geohash;
}

function currentTimestamp() {
  return new Date().valueOf();
}
