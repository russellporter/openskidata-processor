import turfLineChunk from "@turf/line-chunk";
import { FeatureType, LiftFeature, RunFeature } from "openskidata-format";
import request from "request-promise-native";

const elevationProfileResolution = 25;

export default function addElevation(
  elevationServerURL: string
): (feature: RunFeature | LiftFeature) => Promise<RunFeature | LiftFeature> {
  return async (feature: RunFeature | LiftFeature) => {
    const coordinates: number[][] = getCoordinates(feature);
    const elevationProfileCoordinates: number[][] = getCoordinatesForElevationProfile(
      feature
    );

    let elevations: number[];
    try {
      elevations = await loadElevations(
        // Elevation service expects lat,lng order instead of lng,lat of GeoJSON
        Array.from(coordinates).concat(elevationProfileCoordinates).map(([lng, lat]) => [lat, lng]),
        elevationServerURL
      );
    } catch (error) {
      console.log("Failed to load elevations", error);
      return feature;
    }

    const coordinateElevations = elevations.slice(0, coordinates.length);
    const profileElevations = elevations.slice(
      coordinates.length,
      elevations.length
    );

    if (feature.properties.type === FeatureType.Run) {
      feature.properties.elevationProfile =
        profileElevations.length > 0
          ? {
              heights: profileElevations,
              resolution: elevationProfileResolution,
            }
          : null;
    }

    addElevations(feature, coordinateElevations);
    return feature;
  };
}

async function loadElevations(
  coordinates: number[][],
  elevationServerURL: string
): Promise<number[]> {
  const response = await request(elevationServerURL, {
    method: "POST",
    json: coordinates,
    timeout: 5 * 60 * 1000,
    resolveWithFullResponse: true,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw "Failed status code: " + response.statusCode;
  }

  const elevations = response.toJSON().body;

  if (coordinates.length !== elevations.length) {
    throw (
      "Number of coordinates (" +
      coordinates.length +
      ") is different than number of elevations (" +
      elevations.length +
      ")"
    );
  }
  return elevations;
}

function getCoordinates(feature: RunFeature | LiftFeature) {
  let coordinates: number[][];
  switch (feature.geometry.type) {
    case "Point":
      coordinates = [feature.geometry.coordinates];
      break;
    case "LineString":
      coordinates = feature.geometry.coordinates;
      break;
    case "MultiLineString":
    case "Polygon":
      coordinates = feature.geometry.coordinates.flat();
      break;
    case "MultiPolygon":
      coordinates = feature.geometry.coordinates.flat().flat();
      break;
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }

  // Remove elevation in case it was already added to this point
  return coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
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
      return feature.geometry.coordinates.forEach((coords) => {
        addElevationToCoords(coords, elevations[i]);
        i++;
      });
    case "MultiLineString":
    case "Polygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    case "MultiPolygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((innerCoordsSet) => {
          innerCoordsSet.forEach((coords) => {
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
  if (coords.length === 3) {
    // The elevation was already added to this point (this can happen with polygons where the first and last coordinates are the same object in memory)
    return;
  }

  coords.push(elevation);
}
