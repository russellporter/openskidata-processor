import { addWeeks, getDayOfYear, startOfYear, subDays } from "date-fns";
import { SnowCoverHistory } from "openskidata-format";
import { PostgresConfig } from "../Config";
import { PostgresCache } from "./PostgresCache";
import { VIIRSPixel } from "./VIIRSPixelExtractor";

export interface VIIRSCacheData {
  year: number;
  data: [number, number][]; // [snow_cover, cloud_persistence] for each week (1-indexed)
}

export interface VIIRSPixelData {
  tileId: string;
  row: number;
  col: number;
  data: VIIRSCacheData[];
}

/**
 * Convert a 1-indexed week number and cloud persistence to actual day and year.
 */
export function weekToDayAndYear(
  week: number,
  cloudPersistence: number,
  baseYear: number,
): { year: number; dayOfYear: number } | null {
  if (week < 1 || week > 53 || cloudPersistence < 0 || cloudPersistence > 365) {
    return null;
  }

  try {
    const yearStart = startOfYear(new Date(baseYear, 0, 1));
    const weekStart = addWeeks(yearStart, week - 1);
    const actualDate = subDays(weekStart, cloudPersistence);

    return {
      year: actualDate.getFullYear(),
      dayOfYear: getDayOfYear(actualDate),
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check if a snow cover value is valid (not a missing data code).
 *
 * @param snowCover Snow cover value
 * @returns True if the value represents actual snow cover data
 */
export function isValidSnowCover(snowCover: number): boolean {
  // Based on the example: 301 and 400 are missing data codes
  // Valid snow cover is 0-100
  return snowCover >= 0 && snowCover <= 100;
}

/**
 * Convert weekly VIIRS data to daily measurements for a single pixel.
 * Handles cloud persistence that may push measurements to previous/next years.
 *
 * @param pixelData Single pixel's cache data
 * @returns Snow cover history for this pixel
 */
export function convertPixelDataToHistory(
  pixelData: VIIRSPixelData,
): SnowCoverHistory {
  const pixelId = `${pixelData.tileId}/${pixelData.row}/${pixelData.col}`;

  // Group measurements by actual year (accounting for cloud persistence)
  const measurementsByYear = new Map<
    number,
    Map<number, [number, number, number]>
  >();

  for (const yearData of pixelData.data) {
    if (!yearData.data?.length) continue;

    for (let weekIndex = 0; weekIndex < yearData.data.length; weekIndex++) {
      const week = weekIndex + 1;
      const weekData = yearData.data[weekIndex];

      if (!Array.isArray(weekData) || weekData.length < 2) continue;

      const [snowCover, cloudPersistence] = weekData;

      if (
        !isValidSnowCover(snowCover) ||
        typeof cloudPersistence !== "number" ||
        cloudPersistence < 0
      ) {
        continue;
      }

      const dayAndYear = weekToDayAndYear(
        week,
        cloudPersistence,
        yearData.year,
      );
      if (!dayAndYear) continue;

      const { year: actualYear, dayOfYear } = dayAndYear;

      // Initialize year and day maps if needed
      if (!measurementsByYear.has(actualYear)) {
        measurementsByYear.set(actualYear, new Map());
      }

      const yearMap = measurementsByYear.get(actualYear)!;

      // Handle duplicate measurements for the same day - keep the one with less cloud persistence
      if (yearMap.has(dayOfYear)) {
        const existing = yearMap.get(dayOfYear)!;
        if (cloudPersistence < existing[2]) {
          yearMap.set(dayOfYear, [dayOfYear, snowCover, cloudPersistence]);
        }
      } else {
        yearMap.set(dayOfYear, [dayOfYear, snowCover, cloudPersistence]);
      }
    }
  }

  // Convert to final format
  const history: SnowCoverHistory = [];
  const sortedYears = Array.from(measurementsByYear.keys()).sort();

  for (const year of sortedYears) {
    const yearMap = measurementsByYear.get(year)!;

    // Convert measurements and remove cloud persistence from the data
    const dailyMeasurements: [number, number, number][] = Array.from(
      yearMap.values(),
    )
      .map(
        ([dayOfYear, snowCover, _cloudPersistence]): [
          number,
          number,
          number,
        ] => [dayOfYear, snowCover, 100],
      ) // 100% valid pixels for single pixel
      .sort((a, b) => a[0] - b[0]); // Sort by day of year

    if (dailyMeasurements.length > 0) {
      history.push({ year, days: dailyMeasurements });
    }
  }

  return history;
}

/**
 * Aggregate multiple pixels' snow cover data into a single history.
 */
export function aggregatePixelHistories(
  pixelsData: VIIRSPixelData[],
): SnowCoverHistory {
  if (!pixelsData?.length) return [];

  const validPixelsData = pixelsData.filter(
    (pixel) =>
      pixel?.data && Array.isArray(pixel.data) && pixel.data.length > 0,
  );

  if (!validPixelsData.length) return [];

  // Group all measurements by year and day
  const measurementsByYearAndDay = new Map<
    string,
    {
      year: number;
      day: number;
      snowCoverValues: number[];
      pixelIds: string[];
    }
  >();

  for (const pixelData of validPixelsData) {
    const pixelId = `${pixelData.tileId}/${pixelData.row}/${pixelData.col}`;

    try {
      const pixelHistory = convertPixelDataToHistory(pixelData);

      for (const yearData of pixelHistory) {
        if (!yearData?.days || !Array.isArray(yearData.days)) continue;

        for (const dayData of yearData.days) {
          if (!Array.isArray(dayData) || dayData.length < 3) continue;

          const [day, snowCover] = dayData;

          if (
            typeof day !== "number" ||
            typeof snowCover !== "number" ||
            day < 1 ||
            day > 366 ||
            snowCover < 0 ||
            snowCover > 100
          ) {
            continue;
          }

          const key = `${yearData.year}-${day}`;

          if (!measurementsByYearAndDay.has(key)) {
            measurementsByYearAndDay.set(key, {
              year: yearData.year,
              day,
              snowCoverValues: [],
              pixelIds: [],
            });
          }

          const measurement = measurementsByYearAndDay.get(key)!;

          if (measurement.pixelIds.includes(pixelId)) continue;

          measurement.snowCoverValues.push(snowCover);
          measurement.pixelIds.push(pixelId);
        }
      }
    } catch (error) {
      continue;
    }
  }

  if (measurementsByYearAndDay.size === 0) return [];

  // Group by year and calculate aggregated values
  const yearGroups = new Map<number, [number, number, number][]>();

  for (const measurement of Array.from(measurementsByYearAndDay.values())) {
    const { year, day, snowCoverValues } = measurement;

    if (!snowCoverValues.length) continue;

    const averageSnowCover = Math.round(
      snowCoverValues.reduce((sum, val) => sum + val, 0) /
        snowCoverValues.length,
    );

    const validPixelPercentage = Math.round(
      (snowCoverValues.length / validPixelsData.length) * 100,
    );

    if (!yearGroups.has(year)) {
      yearGroups.set(year, []);
    }

    yearGroups.get(year)!.push([day, averageSnowCover, validPixelPercentage]);
  }

  // Convert to final format and sort
  const result: SnowCoverHistory = [];
  const sortedYears = Array.from(yearGroups.keys()).sort();

  for (const year of sortedYears) {
    const days = yearGroups.get(year)!;
    days.sort((a, b) => a[0] - b[0]);

    if (year >= 1900 && year <= 2100 && days.length > 0) {
      result.push({ year, days });
    }
  }

  return result;
}

/**
 * Read VIIRS cache data for a single pixel from PostgreSQL cache.
 *
 * @param cache PostgreSQL cache instance
 * @param tileId Tile identifier (e.g., "h12v04")
 * @param row Pixel row
 * @param col Pixel column
 * @returns Pixel data or null if not found or invalid
 */
async function readPixelCacheData(
  cache: PostgresCache<VIIRSCacheData[]>,
  tileId: string,
  row: number,
  col: number,
): Promise<VIIRSPixelData | null> {
  if (
    !tileId ||
    typeof row !== "number" ||
    typeof col !== "number" ||
    row < 0 ||
    col < 0 ||
    row >= 3000 ||
    col >= 3000 ||
    !/^h\d{2}v\d{2}$/.test(tileId)
  ) {
    return null;
  }

  const cacheKey = `snow_cover:${tileId}:${row}:${col}`;

  try {
    const data = await cache.get(cacheKey);
    if (!data || !Array.isArray(data)) return null;

    const validData = data.filter((yearData) => {
      return (
        yearData &&
        typeof yearData.year === "number" &&
        yearData.year >= 1900 &&
        yearData.year <= 2100 &&
        Array.isArray(yearData.data) &&
        yearData.data.every(
          (weekData) =>
            Array.isArray(weekData) &&
            weekData.length >= 2 &&
            typeof weekData[0] === "number" &&
            typeof weekData[1] === "number",
        )
      );
    });

    if (!validData.length) return null;

    return { tileId, row, col, data: validData };
  } catch (error) {
    return null;
  }
}

/**
 * Get snow cover history for the given VIIRS pixels using PostgreSQL cache.
 *
 * @param cache PostgreSQL cache instance
 * @param pixels Array of VIIRS pixels in format [hTile, vTile, col, row]
 * @returns Aggregated snow cover history across all pixels
 */
export async function getSnowCoverHistory(
  cache: PostgresCache<VIIRSCacheData[]>,
  pixels: VIIRSPixel[],
): Promise<SnowCoverHistory> {
  if (!Array.isArray(pixels)) return [];

  // Convert VIIRS pixels to tile-based format for internal processing
  const pixelsByTile: Record<string, Array<[number, number]>> = {};

  pixels.forEach((pixel) => {
    if (
      !Array.isArray(pixel) ||
      pixel.length < 4 ||
      typeof pixel[0] !== "number" ||
      typeof pixel[1] !== "number" ||
      typeof pixel[2] !== "number" ||
      typeof pixel[3] !== "number"
    ) {
      return;
    }

    const [hTile, vTile, col, row] = pixel;
    const tileId = `h${hTile.toString().padStart(2, "0")}v${vTile.toString().padStart(2, "0")}`;

    if (!pixelsByTile[tileId]) {
      pixelsByTile[tileId] = [];
    }
    pixelsByTile[tileId].push([row, col]);
  });

  const pixelsData: VIIRSPixelData[] = [];

  for (const [tileId, tilePixels] of Object.entries(pixelsByTile)) {
    for (const [row, col] of tilePixels) {
      const pixelData = await readPixelCacheData(cache, tileId, row, col);
      if (pixelData) {
        pixelsData.push(pixelData);
      }
    }
  }

  return aggregatePixelHistories(pixelsData);
}

/**
 * Create a snow cover archive instance and get history for given pixels.
 *
 * @param pixels Array of VIIRS pixels in format [hTile, vTile, col, row]
 * @returns Aggregated snow cover history across all pixels
 */
export async function getSnowCoverHistoryFromCache(
  pixels: VIIRSPixel[],
  postgresConfig: PostgresConfig,
): Promise<SnowCoverHistory> {
  const archive = new PostgresCache<VIIRSCacheData[]>(
    "snow_cover",
    postgresConfig,
    0,
  );
  try {
    await archive.initialize();
    return await getSnowCoverHistory(archive, pixels);
  } finally {
    await archive.close();
  }
}
