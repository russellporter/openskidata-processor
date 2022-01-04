import * as Fs from "fs";
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

export default function convertOSMFileToGeoJSON(
  inputFile: string,
  outputFile: string,
) {
  const content = Fs.readFileSync(inputFile, "utf8");
  Fs.writeFileSync(
    outputFile,
    JSON.stringify(
      convertOSMToGeoJSON(JSON.parse(content))
    )
  );
}

export function convertOSMToGeoJSON(
  osmJSON: any,
) {
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
