import * as Fs from "fs";
import * as JSONStream from "JSONStream";
import osmtogeojson from "osmtogeojson";

const polygonFeatures = {
  building: true,
  highway: {
    included_values: {
      services: true,
      rest_area: true,
      escape: true,
    },
  },
  natural: {
    excluded_values: {
      coastline: true,
      ridge: true,
      arete: true,
      tree_row: true,
    },
  },
  landuse: true,
  waterway: {
    included_values: {
      riverbank: true,
      dock: true,
      boatyard: true,
      dam: true,
    },
  },
  amenity: true,
  leisure: true,
  barrier: {
    included_values: {
      city_wall: true,
      ditch: true,
      hedge: true,
      retaining_wall: true,
      wall: true,
      spikes: true,
    },
  },
  railway: {
    included_values: {
      station: true,
      turntable: true,
      roundhouse: true,
      platform: true,
    },
  },
  area: true,
  boundary: true,
  man_made: {
    excluded_values: {
      cutline: true,
      embankment: true,
      pipeline: true,
    },
  },
  power: {
    included_values: {
      generator: true,
      station: true,
      sub_station: true,
      transformer: true,
    },
  },
  place: true,
  shop: true,
  aeroway: {
    excluded_values: {
      taxiway: true,
    },
  },
  tourism: true,
  historic: true,
  public_transport: true,
  office: true,
  "building:part": true,
  military: true,
  ruins: true,
  "area:highway": true,
  craft: true,
  "piste:type": {
    included_values: {
      downhill: true,
    },
  },
};

export default async function convertOSMFileToGeoJSON(
  inputFile: string,
  outputFile: string
) {
  const osmJSON = await readOSMJSON(inputFile);
  writeFeatureCollection(convertOSMToGeoJSON(osmJSON), outputFile);
}

export function convertOSMToGeoJSON(osmJSON: any) {
  return osmtogeojson(osmJSON, {
    verbose: false,
    polygonFeatures: polygonFeatures,
    flatProperties: false,
    uninterestingTags: (
      tags: { [key: string]: string } | null | undefined,
      // Normally with osmtogeojson, one would not include a feature if the interesting tag is an ignored tag.
      // This is useful for relations where both the relation and the way/node are tagged with the interesting tag.
      // However we handle this ourselves later on by merging overlapping ski runs and ski areas, so don't do this here.
      // By deferring this we can get better data by combining data from the ski run way and the ski run relation, for example.
      // The same is true for winter sports relations that associate multiple ski areas together.
      ignoreTags: { [key: string]: string | boolean }
    ) => false,
    deduplicator: undefined,
  });
}

async function readOSMJSON(path: string): Promise<any> {
  return await new Promise((resolve, reject) => {
    Fs.createReadStream(path)
      .pipe(JSONStream.parse(null))
      .on("root", function (data) {
        // iron out some nasty floating point rounding errors
        if (data.version) data.version = Math.round(data.version * 1000) / 1000;
        data.elements.forEach(function (element: any) {
          if (element.lat) element.lat = Math.round(element.lat * 1e12) / 1e12;
          if (element.lon) element.lon = Math.round(element.lon * 1e12) / 1e12;
        });
        // convert to geojson
        resolve(data);
      })
      .on("error", function (error) {
        reject(error);
      });
  });
}

/**
 * This is much faster than a simple JSON.stringify of the whole geojson
 * object. also, this is less memory intensive and output starts right
 * after the conversion without any additional delay
 *
 * (copied from osmtogeojson CLI)
 */
function writeFeatureCollection(geojson: any, path: string) {
  const outputStream = Fs.createWriteStream(path);

  const separator = "\n";

  outputStream.write(
    "{" +
      separator +
      '"type": "FeatureCollection",' +
      separator +
      '"features": [' +
      separator
  );
  geojson.features.forEach(function (f: any, i: any) {
    outputStream.write(JSON.stringify(f, null, 0));
    if (i != geojson.features.length - 1) {
      outputStream.write("," + separator);
    }
  });
  outputStream.write(separator + "]" + separator + "}" + separator);
  outputStream.close();
}
