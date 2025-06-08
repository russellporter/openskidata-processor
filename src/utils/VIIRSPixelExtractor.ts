import { Feature, Geometry, Polygon, LineString, MultiPolygon, MultiLineString } from "geojson";
import booleanIntersects from "@turf/boolean-intersects";
import { polygon } from "@turf/helpers";

/**
 * VIIRS Pixel Extractor for determining satellite pixels that intersect with GeoJSON geometries.
 * 
 * This utility extracts VIIRS pixel coordinates that intersect with GeoJSON geometries for snow cover analysis.
 * It transforms WGS84 coordinates to the VIIRS Sinusoidal projection and determines which 375m pixels
 * are covered by ski run geometries.
 * 
 * Key features:
 * - Transforms coordinates from WGS84 to VIIRS Sinusoidal projection
 * - Extracts intersecting VIIRS pixels for geometries (Polygon, LineString, Multi*)
 * - Groups pixels by MODIS/VIIRS tile for efficient processing
 * - Handles edge cases with centroid fallback for very small geometries
 * 
 * Based on the Python implementation in snow-cover/src/pixel_extractor.py
 */

// VIIRS/MODIS constants (official specifications)
const PIXEL_SIZE = 375.0; // Exact VIIRS pixel size in meters
const TILE_SIZE_METERS = 1111950.519667; // 10 degrees at equator in sinusoidal projection
const PIXELS_PER_TILE = 3000;
const SPHERE_RADIUS = 6371007.181; // Official VIIRS sphere radius in meters
const GLOBAL_WIDTH = 20015109.354 * 2; // Full global extent horizontally
const GLOBAL_HEIGHT = 10007554.677 * 2; // Full global extent vertically

export interface VIIRSPixel {
  tile: string;
  hTile: number;
  vTile: number;
  pixelCol: number;
  pixelRow: number;
  sinusoidalX: number;
  sinusoidalY: number;
}

export interface SinusoidalCoordinate {
  x: number;
  y: number;
}

export class VIIRSPixelExtractor {
  /**
   * Transform WGS84 coordinates to Sinusoidal projection.
   * This is a simplified implementation of the Sinusoidal projection used by VIIRS/MODIS.
   */
  private transformToSinusoidal(lon: number, lat: number): SinusoidalCoordinate {
    // Convert degrees to radians
    const lonRad = (lon * Math.PI) / 180;
    const latRad = (lat * Math.PI) / 180;
    
    // Sinusoidal projection formulas
    // x = R * lon * cos(lat)
    // y = R * lat
    const x = SPHERE_RADIUS * lonRad * Math.cos(latRad);
    const y = SPHERE_RADIUS * latRad;
    
    return { x, y };
  }

  /**
   * Convert sinusoidal coordinates to VIIRS tile and pixel coordinates.
   */
  private sinusoidalToTileAndPixel(x: number, y: number): VIIRSPixel {
    // Calculate which tile this falls in using standard MODIS/VIIRS grid
    const hTile = Math.max(0, Math.min(35, Math.floor((x + GLOBAL_WIDTH / 2) / TILE_SIZE_METERS)));
    const vTile = Math.max(0, Math.min(17, Math.floor((GLOBAL_HEIGHT / 2 - y) / TILE_SIZE_METERS)));
    
    // Calculate tile bounds using standard grid
    const tileLeft = hTile * TILE_SIZE_METERS - GLOBAL_WIDTH / 2;
    const tileTop = GLOBAL_HEIGHT / 2 - vTile * TILE_SIZE_METERS;
    
    // Calculate pixel within tile (0-2999)
    const col = Math.max(0, Math.min(PIXELS_PER_TILE - 1, Math.floor((x - tileLeft) / PIXEL_SIZE)));
    const row = Math.max(0, Math.min(PIXELS_PER_TILE - 1, Math.floor((tileTop - y) / PIXEL_SIZE)));
    
    return {
      tile: `h${hTile.toString().padStart(2, '0')}v${vTile.toString().padStart(2, '0')}`,
      hTile,
      vTile,
      pixelCol: col,
      pixelRow: row,
      sinusoidalX: x,
      sinusoidalY: y,
    };
  }

  /**
   * Transform a GeoJSON geometry to sinusoidal coordinates.
   */
  private transformGeometryToSinusoidal(geometry: Geometry): Geometry {
    if (geometry.type === "Point") {
      const [lon, lat] = geometry.coordinates;
      const { x, y } = this.transformToSinusoidal(lon, lat);
      return {
        type: "Point",
        coordinates: [x, y],
      };
    }
    
    if (geometry.type === "LineString") {
      return {
        type: "LineString",
        coordinates: geometry.coordinates.map(([lon, lat]) => {
          const { x, y } = this.transformToSinusoidal(lon, lat);
          return [x, y];
        }),
      };
    }
    
    if (geometry.type === "Polygon") {
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map(ring =>
          ring.map(([lon, lat]) => {
            const { x, y } = this.transformToSinusoidal(lon, lat);
            return [x, y];
          })
        ),
      };
    }
    
    if (geometry.type === "MultiPolygon") {
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map(polygon =>
          polygon.map(ring =>
            ring.map(([lon, lat]) => {
              const { x, y } = this.transformToSinusoidal(lon, lat);
              return [x, y];
            })
          )
        ),
      };
    }
    
    if (geometry.type === "MultiLineString") {
      return {
        type: "MultiLineString",
        coordinates: geometry.coordinates.map(lineString =>
          lineString.map(([lon, lat]) => {
            const { x, y } = this.transformToSinusoidal(lon, lat);
            return [x, y];
          })
        ),
      };
    }
    
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }

  /**
   * Check if a pixel polygon intersects with a geometry.
   * Uses proper geometric intersection via Turf.js.
   */
  private pixelIntersectsGeometry(
    pixelX: number,
    pixelY: number,
    geometryTransformed: Geometry
  ): boolean {
    // Create pixel polygon
    const pixelMinX = pixelX - PIXEL_SIZE / 2;
    const pixelMaxX = pixelX + PIXEL_SIZE / 2;
    const pixelMinY = pixelY - PIXEL_SIZE / 2;
    const pixelMaxY = pixelY + PIXEL_SIZE / 2;
    
    const pixelPolygon = polygon([[
      [pixelMinX, pixelMinY],
      [pixelMaxX, pixelMinY],
      [pixelMaxX, pixelMaxY],
      [pixelMinX, pixelMaxY],
      [pixelMinX, pixelMinY]
    ]]);
    
    // Create a Feature for the transformed geometry
    const geometryFeature: Feature = {
      type: "Feature",
      geometry: geometryTransformed,
      properties: {}
    };
    
    // Use Turf.js for proper geometric intersection
    return booleanIntersects(pixelPolygon, geometryFeature);
  }

  /**
   * Get bounding box of a geometry in sinusoidal coordinates.
   */
  private getGeometryBounds(geometry: Geometry): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    const updateBounds = (coords: number[][]) => {
      coords.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
    };
    
    if (geometry.type === "Point") {
      const [x, y] = geometry.coordinates;
      return [x, y, x, y];
    }
    
    if (geometry.type === "LineString") {
      updateBounds(geometry.coordinates);
    } else if (geometry.type === "Polygon") {
      geometry.coordinates.forEach(ring => updateBounds(ring));
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach(polygon =>
        polygon.forEach(ring => updateBounds(ring))
      );
    } else if (geometry.type === "MultiLineString") {
      geometry.coordinates.forEach(lineString => updateBounds(lineString));
    }
    
    return [minX, minY, maxX, maxY];
  }

  /**
   * Get the centroid of a geometry in sinusoidal coordinates.
   */
  private getGeometryCentroid(geometry: Geometry): SinusoidalCoordinate {
    const [minX, minY, maxX, maxY] = this.getGeometryBounds(geometry);
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  }

  /**
   * Get all VIIRS pixel coordinates that intersect with a geometry.
   */
  getGeometryPixelCoordinates(geometry: Geometry): VIIRSPixel[] {
    // Transform geometry to sinusoidal projection
    const geometryTransformed = this.transformGeometryToSinusoidal(geometry);
    
    // Get bounding box in sinusoidal coordinates
    const [minX, minY, maxX, maxY] = this.getGeometryBounds(geometryTransformed);
    
    // Convert corners to tiles to find all potentially affected tiles
    const minInfo = this.sinusoidalToTileAndPixel(minX, maxY); // top-left
    const maxInfo = this.sinusoidalToTileAndPixel(maxX, minY); // bottom-right
    
    const pixelCoords: VIIRSPixel[] = [];
    const processedPixels = new Set<string>(); // To avoid duplicates
    
    // Iterate through all potentially affected tiles
    for (let hTile = minInfo.hTile; hTile <= maxInfo.hTile; hTile++) {
      for (let vTile = minInfo.vTile; vTile <= maxInfo.vTile; vTile++) {
        // Calculate tile bounds using standard MODIS/VIIRS grid
        const tileLeft = hTile * TILE_SIZE_METERS - GLOBAL_WIDTH / 2;
        const tileTop = GLOBAL_HEIGHT / 2 - vTile * TILE_SIZE_METERS;
        
        // Calculate pixel range within this tile to test
        const testMinCol = Math.max(0, Math.floor((minX - tileLeft) / PIXEL_SIZE) - 1);
        const testMaxCol = Math.min(PIXELS_PER_TILE - 1, Math.floor((maxX - tileLeft) / PIXEL_SIZE) + 1);
        const testMinRow = Math.max(0, Math.floor((tileTop - maxY) / PIXEL_SIZE) - 1);
        const testMaxRow = Math.min(PIXELS_PER_TILE - 1, Math.floor((tileTop - minY) / PIXEL_SIZE) + 1);
        
        // Test each pixel in the range
        for (let row = testMinRow; row <= testMaxRow; row++) {
          for (let col = testMinCol; col <= testMaxCol; col++) {
            // Convert pixel to sinusoidal coordinates (pixel center)
            const pixelX = tileLeft + (col + 0.5) * PIXEL_SIZE;
            const pixelY = tileTop - (row + 0.5) * PIXEL_SIZE;
            
            // Check if pixel intersects with the geometry
            if (this.pixelIntersectsGeometry(pixelX, pixelY, geometryTransformed)) {
              const tileName = `h${hTile.toString().padStart(2, '0')}v${vTile.toString().padStart(2, '0')}`;
              const pixelKey = `${tileName}_${col}_${row}`;
              
              if (!processedPixels.has(pixelKey)) {
                processedPixels.add(pixelKey);
                pixelCoords.push({
                  tile: tileName,
                  hTile,
                  vTile,
                  pixelCol: col,
                  pixelRow: row,
                  sinusoidalX: pixelX,
                  sinusoidalY: pixelY,
                });
              }
            }
          }
        }
      }
    }
    
    // Fallback: if no pixels found, assign to centroid pixel
    if (pixelCoords.length === 0) {
      const centroid = this.getGeometryCentroid(geometryTransformed);
      const centroidInfo = this.sinusoidalToTileAndPixel(centroid.x, centroid.y);
      pixelCoords.push({
        tile: centroidInfo.tile,
        hTile: centroidInfo.hTile,
        vTile: centroidInfo.vTile,
        pixelCol: centroidInfo.pixelCol,
        pixelRow: centroidInfo.pixelRow,
        sinusoidalX: centroid.x,
        sinusoidalY: centroid.y,
      });
    }
    
    return pixelCoords;
  }

  /**
   * Extract unique VIIRS pixel coordinates from a GeoJSON feature.
   */
  extractPixelsFromFeature(feature: Feature): Set<string> {
    const uniquePixels = new Set<string>();
    const geometry = feature.geometry;
    
    if (!geometry) {
      return uniquePixels;
    }
    
    if (geometry.type === "Polygon" || geometry.type === "LineString") {
      const pixels = this.getGeometryPixelCoordinates(geometry);
      pixels.forEach(pixel => {
        uniquePixels.add(`${pixel.tile}_${pixel.pixelRow}_${pixel.pixelCol}`);
      });
    } else if (geometry.type === "MultiPolygon" || geometry.type === "MultiLineString") {
      // Handle multi-geometries by processing each sub-geometry
      if (geometry.type === "MultiPolygon") {
        (geometry as MultiPolygon).coordinates.forEach(polygonCoords => {
          const subGeometry: Polygon = { type: "Polygon", coordinates: polygonCoords };
          const pixels = this.getGeometryPixelCoordinates(subGeometry);
          pixels.forEach(pixel => {
            uniquePixels.add(`${pixel.tile}_${pixel.pixelRow}_${pixel.pixelCol}`);
          });
        });
      } else {
        (geometry as MultiLineString).coordinates.forEach(lineStringCoords => {
          const subGeometry: LineString = { type: "LineString", coordinates: lineStringCoords };
          const pixels = this.getGeometryPixelCoordinates(subGeometry);
          pixels.forEach(pixel => {
            uniquePixels.add(`${pixel.tile}_${pixel.pixelRow}_${pixel.pixelCol}`);
          });
        });
      }
    }
    
    return uniquePixels;
  }

  /**
   * Group unique pixels by tile for efficient processing.
   */
  groupPixelsByTile(uniquePixels: Set<string>): Record<string, Array<[number, number]>> {
    const pixelsByTile: Record<string, Array<[number, number]>> = {};
    
    uniquePixels.forEach(pixelKey => {
      const [tile, rowStr, colStr] = pixelKey.split('_');
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      
      if (!pixelsByTile[tile]) {
        pixelsByTile[tile] = [];
      }
      pixelsByTile[tile].push([row, col]);
    });
    
    return pixelsByTile;
  }
}