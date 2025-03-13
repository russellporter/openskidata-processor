// Geometry that's used temporarily as a placeholder. The real geometry (based on member objects) is added later, during the clustering stage.
// The ID ensures a unique identifier when hashing the geometry in buildFeature.
export default function placeholderSiteGeometry(id: number): GeoJSON.Point {
  return { type: "Point", coordinates: [360, 360, id] };
}

export function isPlaceholderGeometry(geometry: GeoJSON.Point): boolean {
  return geometry.coordinates[0] === 360 && geometry.coordinates[1] === 360;
}
