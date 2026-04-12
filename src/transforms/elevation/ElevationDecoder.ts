export type TileEncoding = "mapbox" | "terrarium";

/**
 * Decodes elevation from Mapbox Terrain RGB encoding.
 * Formula: elevation = -10000 + (r * 65536 + g * 256 + b) * 0.1
 */
export function decodeMapboxElevation(r: number, g: number, b: number): number {
  return -10000 + (r * 65536 + g * 256 + b) * 0.1;
}

/**
 * Decodes elevation from Terrarium encoding.
 * Formula: elevation = (r * 256 + g + b / 256) - 32768
 */
export function decodeTerrariumElevation(
  r: number,
  g: number,
  b: number,
): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Reads elevation at an integer pixel coordinate from a raw RGB buffer.
 */
export function elevationAtPixel(
  rawBuffer: Buffer,
  x: number,
  y: number,
  width: number,
  channels: number,
  encoding: TileEncoding,
): number {
  const offset = (y * width + x) * channels;
  const r = rawBuffer[offset];
  const g = rawBuffer[offset + 1];
  const b = rawBuffer[offset + 2];
  switch (encoding) {
    case "mapbox":
      return decodeMapboxElevation(r, g, b);
    case "terrarium":
      return decodeTerrariumElevation(r, g, b);
  }
}

/**
 * Bilinear interpolation of 4 elevation values.
 * e00 = top-left, e10 = top-right, e01 = bottom-left, e11 = bottom-right
 */
export function bilinearInterpolate(
  e00: number,
  e10: number,
  e01: number,
  e11: number,
  fx: number,
  fy: number,
): number {
  const top = e00 * (1 - fx) + e10 * fx;
  const bottom = e01 * (1 - fx) + e11 * fx;
  return top * (1 - fy) + bottom * fy;
}
