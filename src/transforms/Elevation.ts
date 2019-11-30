import request from "request";

export default function addElevation(
  elevationServerURL: string
): (feature: GeoJSON.Feature) => Promise<GeoJSON.Feature> {
  return (feature: GeoJSON.Feature) =>
    new Promise(resolve => {
      const coordinates: number[][] = getCoordinates(feature);
      request(
        elevationServerURL,
        {
          method: "POST",
          json: coordinates,
          timeout: 5 * 60 * 1000
        },
        (error, response) => {
          if (error) {
            console.log(
              "Failed with error: " + error + " coordinates: " + coordinates
            );
          } else if (response.statusCode < 200 || response.statusCode >= 300) {
            console.log("Failed status code: " + response.statusCode);
          } else {
            const elevations = response.toJSON().body;
            addElevations(feature, elevations);
          }
          resolve(feature);
        }
      );
    });
}

function getCoordinates(feature: GeoJSON.Feature) {
  switch (feature.geometry.type) {
    case "Point":
      return [feature.geometry.coordinates];
    case "LineString":
      return feature.geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return feature.geometry.coordinates.flat();
    case "MultiPolygon":
      return feature.geometry.coordinates.flat().flat();
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }
}

function addElevations(feature: GeoJSON.Feature, elevations: number[]) {
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
