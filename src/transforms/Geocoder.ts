import cacache from "cacache";
import DataLoader from "dataloader";
import { LRUMap } from "lru_map";
import * as ngeohash from "ngeohash";
import * as querystring from "querystring";
import request from "request-promise-native";
import * as Config from "../Config";

type GeocodedPosition = any;

// Precision of +-0.61km
const geocodePrecision = 6;

export default class Geocoder {
  private config: Config.GeocodingServerConfig;
  private loader: DataLoader<string, GeocodedPosition>;

  constructor(config: Config.GeocodingServerConfig) {
    this.config = config;
    this.loader = new DataLoader<string, GeocodedPosition>(
      async (loadForKeys) => {
        return [await this.geocodeInternal(loadForKeys[0])];
      },
      {
        batch: false,
        cacheMap: new LRUMap(config.inMemoryCacheSize),
      }
    );
  }

  geocode = async (position: GeoJSON.Position): Promise<GeocodedPosition> => {
    const geohash = ngeohash.encode(position[1], position[0], geocodePrecision);

    return await this.loader.load(geohash);
  };

  private geocodeInternal = async (
    geohash: string
  ): Promise<GeocodedPosition> => {
    try {
      const cacheObject = await cacache.get(
        this.config.cacheDir,
        cacheKey(geohash)
      );
      const content = JSON.parse(cacheObject.data.toString());
      if (content.timestamp + this.config.diskTTL < currentTimestamp()) {
        throw "Cache expired, need to refetch";
      }
      return content.data;
    } catch {
      const point = ngeohash.decode(geohash);
      const response = await request({
        json: true,
        uri:
          this.config.url +
          "?" +
          querystring.stringify({ lon: point.longitude, lat: point.latitude }),
      });
      await cacache.put(
        this.config.cacheDir,
        cacheKey(geohash),
        JSON.stringify({
          data: response,
          timestamp: currentTimestamp(),
        })
      );
      return response;
    }
  };
}

function cacheKey(geohash: string) {
  return "geocode/" + geohash;
}

function currentTimestamp() {
  return new Date().valueOf();
}
