import turfLineChunk from "@turf/line-chunk";
import { FeatureType, LiftFeature, RunFeature } from "openskidata-format";
import request from "request";

const elevationProfileResolution = 25;

export default function addElevation(
  elevationServerURL: string
): (feature: RunFeature | LiftFeature) => Promise<RunFeature | LiftFeature> {
  return async (feature: RunFeature | LiftFeature) => {
    const coordinates: number[][] = getCoordinates(feature);
    const elevationProfileCoordinates: number[][] = getCoordinatesForElevationProfile(
      feature
    );

    const elevations = await loadElevations(
      Array.from(coordinates).concat(elevationProfileCoordinates),
      elevationServerURL
    );

    const coordinateElevations = elevations.slice(0, coordinates.length);
    const profileElevations = elevations.slice(
      coordinates.length,
      elevationProfileCoordinates.length
    );

    if (feature.properties.type === FeatureType.Run) {
      feature.properties.elevationProfile =
        profileElevations.length > 0
          ? {
              heights: profileElevations,
              resolution: elevationProfileResolution
            }
          : null;
    }

    addElevations(feature, coordinateElevations);
    return feature;
  };
}

function loadElevations(
  coordinates: number[][],
  elevationServerURL: string
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    request(
      elevationServerURL,
      {
        method: "POST",
        json: coordinates,
        timeout: 5 * 60 * 1000
      },
      (error, response) => {
        if (error) {
          reject(
            "Failed with error: " + error + " coordinates: " + coordinates
          );
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
          reject("Failed status code: " + response.statusCode);
        } else {
          const elevations = response.toJSON().body;

          if (coordinates.length !== elevations.length) {
            reject(
              "Number of coordinates (" +
                coordinates.length +
                ") is different than number of elevations (" +
                elevations.length +
                ")"
            );
          }
          resolve(elevations);
        }
      }
    );
  });
}

function getCoordinates(feature: RunFeature | LiftFeature) {
  switch (feature.geometry.type) {
    case "Point":
      return [feature.geometry.coordinates];
    case "LineString":
      return feature.geometry.coordinates;
    case "Polygon":
      return feature.geometry.coordinates.flat();
    case "MultiPolygon":
      return feature.geometry.coordinates.flat().flat();
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }
}

function getCoordinatesForElevationProfile(feature: RunFeature | LiftFeature) {
  if (feature.properties.type === FeatureType.Lift) {
    return [];
  }

  if (feature.geometry.type !== "LineString") {
    return [];
  }

  const subfeatures = turfLineChunk(
    feature.geometry,
    elevationProfileResolution,
    { units: "meters" }
  ).features;
  const points: [number, number][] = [];
  for (let subline of subfeatures) {
    const geometry = subline.geometry;
    if (geometry) {
      const point = geometry.coordinates[0];
      points.push([point[0], point[1]]);
    }
  }
  if (subfeatures.length > 0) {
    const geometry = subfeatures[subfeatures.length - 1].geometry;
    if (geometry) {
      const coords = geometry.coordinates;
      if (coords.length > 1) {
        const point = coords[coords.length - 1];
        points.push([point[0], point[1]]);
      }
    }
  }

  return points;
}

function addElevations(
  feature: RunFeature | LiftFeature,
  elevations: number[]
) {
  let i = 0;
  switch (feature.geometry.type) {
    case "Point":
      return addElevationToCoords(feature.geometry.coordinates, elevations[i]);
    case "LineString":
      return feature.geometry.coordinates.forEach(coords => {
        addElevationToCoords(coords, elevations[i]);
        i++;
      });
    case "MultiLineString":
    case "Polygon":
      return feature.geometry.coordinates.forEach(coordsSet => {
        coordsSet.forEach(coords => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    case "MultiPolygon":
      return feature.geometry.coordinates.forEach(coordsSet => {
        coordsSet.forEach(innerCoordsSet => {
          innerCoordsSet.forEach(coords => {
            addElevationToCoords(coords, elevations[i]);
            i++;
          });
        });
      });
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }
}

function addElevationToCoords(coords: number[], elevation: number) {
  if (coords.length != 2) {
    throw "Unexpected coords length " + coords.length;
  }

  coords.push(elevation);
}
