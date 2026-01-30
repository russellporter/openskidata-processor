export interface TilePixel {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

export interface InterpolationCorner {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
}

export interface InterpolationSetup {
  corners: [
    InterpolationCorner,
    InterpolationCorner,
    InterpolationCorner,
    InterpolationCorner,
  ];
  fx: number;
  fy: number;
}

/**
 * Converts (lon, lat, zoom, tileSize) to tile coordinates (tileX, tileY)
 * and fractional pixel coordinates (pixelX, pixelY) using Web Mercator projection.
 */
export function lonLatToTilePixel(
  lon: number,
  lat: number,
  zoom: number,
  tileSize: number,
): TilePixel {
  let siny = Math.sin((lat * Math.PI) / 180);
  // Truncating to 0.9999 effectively limits latitude to 89.189. This is
  // about a third of a tile past the edge of the world tile.
  siny = Math.min(Math.max(siny, -0.9999), 0.9999);

  const xWorld = tileSize * (0.5 + lon / 360);
  const yWorld =
    tileSize * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));

  const scale = 1 << zoom;

  const tileX = Math.floor((xWorld * scale) / tileSize);
  const tileY = Math.floor((yWorld * scale) / tileSize);

  // Return fractional pixel coordinates for sub-pixel precision
  const pixelX = xWorld * scale - tileX * tileSize;
  const pixelY = yWorld * scale - tileY * tileSize;

  return { tileX, tileY, pixelX, pixelY };
}

/**
 * Resolves the 4 corners needed for bilinear interpolation to their
 * correct tile + pixel coordinates, handling cross-tile boundaries.
 *
 * Returns null if any corner would fall outside the world boundary (vertically).
 */
export function getInterpolationSetup(
  tileX: number,
  tileY: number,
  pixelX: number,
  pixelY: number,
  zoom: number,
  tileSize: number,
): InterpolationSetup | null {
  const x0 = Math.floor(pixelX);
  const y0 = Math.floor(pixelY);
  const fx = pixelX - x0;
  const fy = pixelY - y0;

  const numTiles = 1 << zoom;

  const cornerPixels: [number, number][] = [
    [x0, y0],
    [x0 + 1, y0],
    [x0, y0 + 1],
    [x0 + 1, y0 + 1],
  ];

  const corners: InterpolationCorner[] = [];

  for (const [px, py] of cornerPixels) {
    let cx = tileX;
    let cy = tileY;
    let localX = px;
    let localY = py;

    if (localX >= tileSize) {
      localX = 0;
      cx = (cx + 1) % numTiles;
    } else if (localX < 0) {
      localX = tileSize - 1;
      cx = (cx - 1 + numTiles) % numTiles;
    }

    if (localY >= tileSize) {
      localY = 0;
      cy = cy + 1;
    } else if (localY < 0) {
      localY = tileSize - 1;
      cy = cy - 1;
    }

    if (cy < 0 || cy >= numTiles) {
      return null;
    }

    corners.push({ tileX: cx, tileY: cy, pixelX: localX, pixelY: localY });
  }

  return {
    corners: corners as [
      InterpolationCorner,
      InterpolationCorner,
      InterpolationCorner,
      InterpolationCorner,
    ],
    fx,
    fy,
  };
}
