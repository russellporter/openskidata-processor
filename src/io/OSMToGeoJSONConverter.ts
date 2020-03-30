import * as Fs from "fs";
import osmtogeojson from "osmtogeojson";

const polygonFeatures = {
  building: true,
  highway: {
    included_values: {
      services: true,
      rest_area: true,
      escape: true
    }
  },
  natural: {
    excluded_values: {
      coastline: true,
      ridge: true,
      arete: true,
      tree_row: true
    }
  },
  landuse: true,
  waterway: {
    included_values: {
      riverbank: true,
      dock: true,
      boatyard: true,
      dam: true
    }
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
      spikes: true
    }
  },
  railway: {
    included_values: {
      station: true,
      turntable: true,
      roundhouse: true,
      platform: true
    }
  },
  area: true,
  boundary: true,
  man_made: {
    excluded_values: {
      cutline: true,
      embankment: true,
      pipeline: true
    }
  },
  power: {
    included_values: {
      generator: true,
      station: true,
      sub_station: true,
      transformer: true
    }
  },
  place: true,
  shop: true,
  aeroway: {
    excluded_values: {
      taxiway: true
    }
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
      downhill: true
    }
  }
};

export default function convertOSMFileToGeoJSON(
  inputFile: string,
  outputFile: string,
  shouldIncludeFeature: (tags: { [key: string]: string }) => boolean
) {
  const content = Fs.readFileSync(inputFile, "utf8");
  Fs.writeFileSync(
    outputFile,
    JSON.stringify(
      convertOSMToGeoJSON(JSON.parse(content), shouldIncludeFeature)
    )
  );
}

export function convertOSMToGeoJSON(
  osmJSON: any,
  shouldIncludeFeature: (tags: { [key: string]: string }) => boolean
) {
  return osmtogeojson(osmJSON, {
    verbose: false,
    polygonFeatures: polygonFeatures,
    flatProperties: true,
    uninterestingTags: (
      tags: { [key: string]: string },
      ignoreTags: { [key: string]: string | boolean }
    ) => !shouldIncludeFeature(tagsExceptIgnoredOnes(tags, ignoreTags)),
    deduplicator: undefined
  });
}

function tagsExceptIgnoredOnes(
  tags: { [key: string]: string },
  ignoreTags: { [key: string]: string | boolean }
): { [key: string]: string } {
  return Object.keys(tags)
    .filter(key => ignoreTags[key] !== true && ignoreTags[key] !== tags[key])
    .reduce(
      (res: { [key: string]: string }, key) => ((res[key] = tags[key]), res),
      {}
    );
}
