import { FeatureCollection, Feature } from "geojson";
import { VIIRSPixelExtractor } from "./VIIRSPixelExtractor";

/**
 * Extract unique VIIRS pixels from a GeoJSON FeatureCollection.
 *
 * @param featureCollection GeoJSON FeatureCollection containing geometries
 * @returns Object with unique pixels grouped by tile
 */
export function extractVIIRSPixelsFromGeoJSON(
  featureCollection: FeatureCollection,
): Record<string, Array<[number, number]>> {
  const extractor = new VIIRSPixelExtractor();
  const allUniquePixels = new Set<string>();

  // Process each feature in the collection
  featureCollection.features.forEach((feature: Feature, index: number) => {
    const featurePixels = extractor.extractPixelsFromFeature(feature);

    // Add to global unique set
    featurePixels.forEach((pixel) => allUniquePixels.add(pixel));

    // Log progress for large collections
    if ((index + 1) % 100 === 0) {
      console.log(
        `Processed ${index + 1} features, found ${allUniquePixels.size} unique pixels so far`,
      );
    }
  });

  console.log(`Total unique pixels found: ${allUniquePixels.size}`);

  // Group by tile for efficient processing
  const pixelsByTile = extractor.groupPixelsByTile(allUniquePixels);

  console.log(
    `Pixels distributed across ${Object.keys(pixelsByTile).length} tiles:`,
  );
  Object.entries(pixelsByTile).forEach(([tile, pixels]) => {
    console.log(`  ${tile}: ${pixels.length} pixels`);
  });

  return pixelsByTile;
}

/**
 * Extract VIIRS pixels from a single geometry feature.
 *
 * @param feature GeoJSON Feature with geometry
 * @returns Array of VIIRS pixel information
 */
export function extractVIIRSPixelsFromFeature(feature: Feature) {
  const extractor = new VIIRSPixelExtractor();

  if (!feature.geometry) {
    return [];
  }

  return extractor.getGeometryPixelCoordinates(feature.geometry);
}
