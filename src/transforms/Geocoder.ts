import { Mutex } from "async-mutex";
import cacache from "cacache";
import DataLoader from "dataloader";
import fetchRetry from "fetch-retry";
import * as iso3166_2 from "iso3166-2-db";
import { Region } from "iso3166-2-db";
import { LRUMap } from "lru_map";
import * as ngeohash from "ngeohash";
import * as Config from "../Config";

export type PhotonGeocode = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  {
    country?: string;
    countrycode?: string;
    state?: string;
    county?: string;
    city?: string;
  }
>;

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
  private loader: DataLoader<string, Geocode | null>;
  private remoteErrorCount = 0;
  private maxRemoteErrors = 10;
  private mutex = new Mutex();

  constructor(config: Config.GeocodingServerConfig) {
    this.config = config;
    this.loader = new DataLoader<string, Geocode | null>(
      async (loadForKeys) => {
        return [await this.geocodeInternal(loadForKeys[0])];
      },
      {
        batch: false,
        cacheMap: new LRUMap(config.inMemoryCacheSize),
      }
    );
  }

  geocode = async (position: GeoJSON.Position): Promise<Geocode | null> => {
    const geohash = ngeohash.encode(position[1], position[0], geocodePrecision);

    return await this.loader.load(geohash);
  };

  private geocodeInternal = async (
    geohash: string
  ): Promise<Geocode | null> => {
    try {
      const cacheObject = await cacache.get(
        this.config.cacheDir,
        cacheKey(geohash)
      );
      const content = JSON.parse(cacheObject.data.toString());
      if (content.timestamp + this.config.diskTTL < currentTimestamp()) {
        throw "Cache expired, need to refetch";
      }
      return this.enhance(content.data);
    } catch {
      if (this.remoteErrorCount >= this.maxRemoteErrors) {
        throw "Too many errors, not trying remote";
      }

      try {
        return this.geocodeRemote(geohash);
      } catch {
        this.remoteErrorCount++;
        return null;
      }
    }
  };

  private geocodeRemote = async (geohash: string): Promise<Geocode | null> => {
    return this.mutex.runExclusive(async () => {
      const point = ngeohash.decode(geohash);
      const response = await fetchRetry(fetch)(
        `${this.config.url}?lon=${point.longitude}&lat=${point.latitude}&lang=en`,
        {
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
        }
      ).then((res) => res.json());

      await cacache.put(
        this.config.cacheDir,
        cacheKey(geohash),
        JSON.stringify({
          data: response,
          timestamp: currentTimestamp(),
        })
      );
      return this.enhance(response);
    });
  };

  private enhance = (rawGeocode: PhotonGeocode): Geocode | null => {
    console.assert(
      rawGeocode.features.length <= 1,
      "Expected Photon geocode to only have at most a single feature."
    );
    if (rawGeocode.features.length === 0) {
      return null;
    }

    const properties = rawGeocode.features[0].properties;
    if (!properties.countrycode) {
      return null;
    }

    const country = iso3166_2.getDataSet()[properties.countrycode];
    if (!country) {
      console.log(
        `Could not find country info for code ${properties.countrycode}`
      );
      return null;
    }

    let region: Region | null = null;

    if (properties.state !== undefined) {
      region =
        country.regions.find(
          (region: Region) => region.name === properties.state
        ) || null;
    }

    if (region === null && properties.county !== undefined) {
      region =
        country.regions.find(
          (region: Region) => region.name === properties.county
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
