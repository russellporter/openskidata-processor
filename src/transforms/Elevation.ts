import {
  extractPointsForElevationProfile,
  FeatureType,
  LiftFeature,
  RunFeature,
} from "openskidata-format";

const elevationProfileResolution = 25;

export default function addElevation(
  elevationServerURL: string,
): (feature: RunFeature | LiftFeature) => Promise<RunFeature | LiftFeature> {
  return async (feature: RunFeature | LiftFeature) => {
    const coordinates: number[][] = getCoordinates(feature);
    const geometry = feature.geometry;
    const elevationProfileCoordinates: number[][] =
      geometry.type === "LineString"
        ? extractPointsForElevationProfile(geometry, elevationProfileResolution)
            .coordinates
        : [];

    let elevations: number[];
    try {
      elevations = await loadElevations(
        // Elevation service expects lat,lng order instead of lng,lat of GeoJSON
        Array.from(coordinates)
          .concat(elevationProfileCoordinates)
          .map(([lng, lat]) => [lat, lng]),
        elevationServerURL,
      );
    } catch (error) {
      console.log("Failed to load elevations", error);
      return feature;
    }

    const coordinateElevations = elevations.slice(0, coordinates.length);
    const profileElevations = elevations.slice(
      coordinates.length,
      elevations.length,
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
  elevationServerURL: string,
): Promise<number[]> {
  const response = await fetch(elevationServerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(coordinates),
  });

  if (!response.ok) {
    throw new Error("Failed status code: " + response.status);
  }

  const elevations: (number | null)[] = await response.json();

  if (coordinates.length !== elevations.length) {
    throw new Error(
      "Number of coordinates (" +
        coordinates.length +
        ") is different than number of elevations (" +
        elevations.length +
        ")",
    );
  }

  // If there is a data hole, missing elevation data is represented as null.
  if (
    elevations.some((elevation) => {
      elevation === null;
    })
  ) {
    throw new Error("Elevation data contains nulls");
  }

  return elevations as number[];
}

function getCoordinates(feature: RunFeature | LiftFeature) {
  let coordinates: number[][];
  const geometryType = feature.geometry.type;
  switch (geometryType) {
    case "LineString":
      coordinates = feature.geometry.coordinates;
      break;
    case "MultiLineString":
      coordinates = feature.geometry.coordinates.flat();
      break;
    case "Polygon":
      coordinates = feature.geometry.coordinates.flat();
      break;
    default:
      const exhaustiveCheck: never = geometryType;
      throw "Geometry type " + exhaustiveCheck + " not implemented";
  }

  // Remove elevation in case it was already added to this point
  return coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
}

function addElevations(
  feature: RunFeature | LiftFeature,
  elevations: number[],
) {
  let i = 0;
  const geometryType = feature.geometry.type;
  switch (geometryType) {
    case "LineString":
      return feature.geometry.coordinates.forEach((coords) => {
        addElevationToCoords(coords, elevations[i]);
        i++;
      });
    case "MultiLineString":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    case "Polygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    default:
      const exhaustiveCheck: never = geometryType;
      throw "Geometry type " + exhaustiveCheck + " not implemented";
  }
}

function addElevationToCoords(coords: number[], elevation: number) {
  if (coords.length === 3) {
    // The elevation was already added to this point (this can happen with polygons where the first and last coordinates are the same object in memory)
    return;
  }

  coords.push(elevation);
}
