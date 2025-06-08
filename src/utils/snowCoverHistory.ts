import * as fs from 'fs';
import * as path from 'path';
import { SnowCoverHistory } from 'openskidata-format';
import { isLeapYear, getDayOfYear, addWeeks, startOfYear, subDays } from 'date-fns';


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
 * Week 1 = Jan 1-7. Cloud persistence indicates how many days old the data is.
 * 
 * @param week Week number (1-52/53)
 * @param cloudPersistence Number of days the data is old (must be >= 0)
 * @param baseYear The year this week belongs to
 * @returns Object with actualYear and dayOfYear, or null if invalid
 */
export function weekToDayAndYear(week: number, cloudPersistence: number, baseYear: number): { year: number; dayOfYear: number } | null {
  // Validate inputs
  if (week < 1 || week > 53 || cloudPersistence < 0 || cloudPersistence > 365) {
    console.debug('Invalid week or cloud persistence values', { 
      week, 
      cloudPersistence, 
      baseYear,
      reason: week < 1 || week > 53 ? 'week out of range' : 'cloud persistence out of range'
    });
    return null;
  }

  try {
    // Week 1 starts on Jan 1st
    const yearStart = startOfYear(new Date(baseYear, 0, 1));
    const weekStart = addWeeks(yearStart, week - 1); // Convert to 0-indexed for addWeeks
    const actualDate = subDays(weekStart, cloudPersistence);
    
    const actualYear = actualDate.getFullYear();
    const dayOfYear = getDayOfYear(actualDate);
    
    return { year: actualYear, dayOfYear };
  } catch (error) {
    console.error('Error calculating day and year from week', { 
      week, 
      cloudPersistence, 
      baseYear, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
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
export function convertPixelDataToHistory(pixelData: VIIRSPixelData): SnowCoverHistory {
  const pixelId = `${pixelData.tileId}/${pixelData.row}/${pixelData.col}`;
  
  // Group measurements by actual year (accounting for cloud persistence)
  const measurementsByYear = new Map<number, Map<number, [number, number, number]>>();
  
  for (const yearData of pixelData.data) {
    // Handle edge case: empty data array
    if (!yearData.data || yearData.data.length === 0) {
      console.debug('Empty data array for pixel year', { pixelId, year: yearData.year });
      continue;
    }
    
    for (let weekIndex = 0; weekIndex < yearData.data.length; weekIndex++) {
      const week = weekIndex + 1; // Convert to 1-indexed week
      const weekData = yearData.data[weekIndex];
      
      // Handle edge case: malformed week data
      if (!Array.isArray(weekData) || weekData.length < 2) {
        console.warn('Malformed week data for pixel', { 
          pixelId, 
          year: yearData.year, 
          week, 
          weekData 
        });
        continue;
      }
      
      const [snowCover, cloudPersistence] = weekData;
      
      // Skip invalid snow cover data
      if (!isValidSnowCover(snowCover)) {
        console.debug('Invalid snow cover value for pixel', { 
          pixelId, 
          year: yearData.year, 
          week, 
          snowCover 
        });
        continue;
      }
      
      // Validate cloud persistence
      if (typeof cloudPersistence !== 'number' || cloudPersistence < 0) {
        console.warn('Invalid cloud persistence for pixel', { 
          pixelId, 
          year: yearData.year, 
          week, 
          cloudPersistence 
        });
        continue;
      }
      
      const dayAndYear = weekToDayAndYear(week, cloudPersistence, yearData.year);
      
      // Skip if the day calculation failed
      if (!dayAndYear) {
        console.warn('Failed to calculate day and year for pixel', { 
          pixelId, 
          year: yearData.year, 
          week, 
          cloudPersistence 
        });
        continue;
      }
      
      const { year: actualYear, dayOfYear } = dayAndYear;
      
      // Initialize year and day maps if needed
      if (!measurementsByYear.has(actualYear)) {
        measurementsByYear.set(actualYear, new Map());
      }
      
      const yearMap = measurementsByYear.get(actualYear)!;
      
      // Handle duplicate measurements for the same day - keep the one with less cloud persistence
      if (yearMap.has(dayOfYear)) {
        const existing = yearMap.get(dayOfYear)!;
        const existingCloudPersistence = existing[2]; // We'll store cloud persistence in the third position temporarily
        
        if (cloudPersistence < existingCloudPersistence) {
          // Current measurement is fresher, replace the existing one
          yearMap.set(dayOfYear, [dayOfYear, snowCover, cloudPersistence]);
          console.debug('Replaced duplicate measurement with fresher data', { 
            pixelId, 
            year: actualYear, 
            dayOfYear, 
            oldCloudPersistence: existingCloudPersistence, 
            newCloudPersistence: cloudPersistence 
          });
        } else {
          console.debug('Kept existing measurement over duplicate', { 
            pixelId, 
            year: actualYear, 
            dayOfYear, 
            existingCloudPersistence, 
            currentCloudPersistence: cloudPersistence 
          });
        }
      } else {
        // For a single pixel, valid pixel percentage is 100%
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
    const dailyMeasurements: [number, number, number][] = Array.from(yearMap.values())
      .map(([dayOfYear, snowCover, _cloudPersistence]): [number, number, number] => [dayOfYear, snowCover, 100]) // 100% valid pixels for single pixel
      .sort((a, b) => a[0] - b[0]); // Sort by day of year
    
    if (dailyMeasurements.length > 0) {
      history.push({
        year,
        days: dailyMeasurements
      });
      
      console.debug('Processed pixel year data', { 
        pixelId, 
        year, 
        measurementCount: dailyMeasurements.length 
      });
    }
  }
  
  return history;
}

/**
 * Aggregate multiple pixels' snow cover data into a single history.
 * Calculates average snow cover and percentage of valid pixels for each day.
 * Ensures that multiple measurements for the same day from different pixels are properly averaged.
 * 
 * @param pixelsData Array of pixel data
 * @returns Aggregated snow cover history
 */
export function aggregatePixelHistories(pixelsData: VIIRSPixelData[]): SnowCoverHistory {
  // Handle edge case: empty input
  if (!pixelsData || pixelsData.length === 0) {
    console.debug('No pixel data provided for aggregation');
    return [];
  }
  
  // Filter out pixels with no data
  const validPixelsData = pixelsData.filter(pixel => 
    pixel && pixel.data && Array.isArray(pixel.data) && pixel.data.length > 0
  );
  
  if (validPixelsData.length === 0) {
    console.warn('No valid pixel data found for aggregation', { 
      totalPixels: pixelsData.length 
    });
    return [];
  }
  
  console.debug('Starting pixel aggregation', { 
    totalPixels: pixelsData.length, 
    validPixels: validPixelsData.length 
  });
  
  // Group all measurements by year and day
  const measurementsByYearAndDay = new Map<string, {
    year: number;
    day: number;
    snowCoverValues: number[];
    pixelIds: string[];
  }>();
  
  for (const pixelData of validPixelsData) {
    const pixelId = `${pixelData.tileId}/${pixelData.row}/${pixelData.col}`;
    
    try {
      const pixelHistory = convertPixelDataToHistory(pixelData);
      
      for (const yearData of pixelHistory) {
        // Handle edge case: malformed year data
        if (!yearData || !yearData.days || !Array.isArray(yearData.days)) {
          console.warn('Malformed year data for pixel', { pixelId, yearData });
          continue;
        }
        
        for (const dayData of yearData.days) {
          // Handle edge case: malformed day data
          if (!Array.isArray(dayData) || dayData.length < 3) {
            console.warn('Malformed day data for pixel', { pixelId, dayData });
            continue;
          }
          
          const [day, snowCover, validPixelPercent] = dayData;
          
          // Validate day data
          if (typeof day !== 'number' || typeof snowCover !== 'number' || 
              day < 1 || day > 366 || snowCover < 0 || snowCover > 100) {
            console.warn('Invalid day data for pixel', { 
              pixelId, 
              year: yearData.year, 
              day, 
              snowCover, 
              validPixelPercent 
            });
            continue;
          }
          
          const key = `${yearData.year}-${day}`;
          
          if (!measurementsByYearAndDay.has(key)) {
            measurementsByYearAndDay.set(key, {
              year: yearData.year,
              day,
              snowCoverValues: [],
              pixelIds: []
            });
          }
          
          const measurement = measurementsByYearAndDay.get(key)!;
          
          // Check for duplicate pixel measurements on the same day
          if (measurement.pixelIds.includes(pixelId)) {
            console.warn('Duplicate measurement for same pixel on same day', { 
              pixelId, 
              year: yearData.year, 
              day 
            });
            continue;
          }
          
          measurement.snowCoverValues.push(snowCover);
          measurement.pixelIds.push(pixelId);
        }
      }
    } catch (error) {
      // Log warning but continue with other pixels
      console.error('Failed to process pixel data during aggregation', { 
        pixelId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      continue;
    }
  }
  
  // Handle edge case: no valid measurements found
  if (measurementsByYearAndDay.size === 0) {
    console.warn('No valid measurements found during aggregation');
    return [];
  }
  
  console.debug('Aggregating measurements', { 
    totalMeasurements: measurementsByYearAndDay.size 
  });
  
  // Group by year and calculate aggregated values
  const yearGroups = new Map<number, [number, number, number][]>();
  
  for (const measurement of measurementsByYearAndDay.values()) {
    const { year, day, snowCoverValues } = measurement;
    
    // Handle edge case: no snow cover values (shouldn't happen but be safe)
    if (snowCoverValues.length === 0) {
      console.warn('No snow cover values for measurement', { year, day });
      continue;
    }
    
    // Calculate average snow cover
    const averageSnowCover = Math.round(
      snowCoverValues.reduce((sum, val) => sum + val, 0) / snowCoverValues.length
    );
    
    // Calculate percentage of valid pixels
    const validPixelPercentage = Math.round(
      (snowCoverValues.length / validPixelsData.length) * 100
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
    
    // Sort by day of year
    days.sort((a, b) => a[0] - b[0]);
    
    // Validate year range (reasonable bounds)
    if (year >= 1900 && year <= 2100 && days.length > 0) {
      result.push({ year, days });
      
      console.debug('Aggregated year data', { 
        year, 
        dayCount: days.length,
        avgValidPixels: Math.round(days.reduce((sum, [,, valid]) => sum + valid, 0) / days.length)
      });
    } else {
      console.warn('Skipped year data due to invalid year or no measurements', { year, dayCount: days.length });
    }
  }
  
  console.debug('Completed pixel aggregation', { 
    yearCount: result.length,
    totalDays: result.reduce((sum, year) => sum + year.days.length, 0)
  });
  
  return result;
}

/**
 * Read VIIRS cache data for a single pixel.
 * 
 * @param cacheDir Path to the cache directory
 * @param tileId Tile identifier (e.g., "h12v04")
 * @param row Pixel row
 * @param col Pixel column
 * @returns Pixel data or null if file doesn't exist or is invalid
 */
export function readPixelCacheData(
  cacheDir: string,
  tileId: string,
  row: number,
  col: number
): VIIRSPixelData | null {
  const pixelId = `${tileId}/${row}/${col}`;
  
  // Validate inputs
  if (!cacheDir || !tileId || typeof row !== 'number' || typeof col !== 'number' ||
      row < 0 || col < 0 || row >= 3000 || col >= 3000) {
    console.warn('Invalid input parameters for reading pixel cache', { 
      cacheDir: !!cacheDir, 
      tileId, 
      row, 
      col 
    });
    return null;
  }
  
  // Validate tile ID format (should be like "h12v04")
  if (!/^h\d{2}v\d{2}$/.test(tileId)) {
    console.warn('Invalid tile ID format', { tileId, pixelId });
    return null;
  }
  
  const filePath = path.join(cacheDir, tileId, row.toString(), `${col}.json`);
  
  // Check if file exists
  try {
    if (!fs.existsSync(filePath)) {
      console.debug('Cache file does not exist', { filePath, pixelId });
      return null;
    }
  } catch (error) {
    // Handle file system errors (permissions, etc.)
    console.error('File system error checking cache file existence', { 
      filePath, 
      pixelId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return null;
  }
  
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Handle empty files
    if (!fileContent.trim()) {
      console.warn('Empty cache file', { filePath, pixelId });
      return null;
    }
    
    const data: VIIRSCacheData[] = JSON.parse(fileContent);
    
    // Validate parsed data structure
    if (!Array.isArray(data)) {
      console.warn('Invalid cache file format - not an array', { filePath, pixelId });
      return null;
    }
    
    // Validate each year's data structure
    const validData = data.filter((yearData, index) => {
      if (!yearData || typeof yearData.year !== 'number' || !Array.isArray(yearData.data)) {
        console.warn('Invalid year data structure in cache file', { 
          filePath, 
          pixelId, 
          yearIndex: index, 
          yearData 
        });
        return false;
      }
      
      // Validate year range
      if (yearData.year < 1900 || yearData.year > 2100) {
        console.warn('Year out of valid range in cache file', { 
          filePath, 
          pixelId, 
          year: yearData.year 
        });
        return false;
      }
      
      // Validate data array structure
      const isValid = yearData.data.every((weekData, weekIndex) => {
        const valid = Array.isArray(weekData) && 
                     weekData.length >= 2 && 
                     typeof weekData[0] === 'number' && 
                     typeof weekData[1] === 'number';
        
        if (!valid) {
          console.warn('Invalid week data in cache file', { 
            filePath, 
            pixelId, 
            year: yearData.year, 
            weekIndex: weekIndex + 1, 
            weekData 
          });
        }
        
        return valid;
      });
      
      return isValid;
    });
    
    // Return null if no valid data found
    if (validData.length === 0) {
      console.warn('No valid year data found in cache file', { filePath, pixelId });
      return null;
    }
    
    if (validData.length < data.length) {
      console.warn('Some year data was filtered out due to validation errors', { 
        filePath, 
        pixelId, 
        originalCount: data.length, 
        validCount: validData.length 
      });
    }
    
    console.debug('Successfully read pixel cache data', { 
      pixelId, 
      yearCount: validData.length 
    });
    
    return {
      tileId,
      row,
      col,
      data: validData
    };
  } catch (error) {
    console.error('Failed to read or parse cache file', { 
      filePath, 
      pixelId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return null;
  }
}

/**
 * Get snow cover history for a list of VIIRS pixels.
 * 
 * @param cacheDir Path to the snow cover cache directory
 * @param pixels Array of pixels grouped by tile (from extractVIIRSPixels)
 * @returns Aggregated snow cover history across all pixels
 */
export function getSnowCoverHistory(
  cacheDir: string,
  pixels: Record<string, Array<[number, number]>>
): SnowCoverHistory {
  // Validate inputs
  if (!cacheDir || !pixels || typeof pixels !== 'object') {
    console.error('Invalid input parameters for getSnowCoverHistory', { 
      cacheDir: !!cacheDir, 
      pixels: !!pixels 
    });
    return [];
  }
  
  const pixelsData: VIIRSPixelData[] = [];
  let totalPixels = 0;
  let successfulReads = 0;
  let failedReads = 0;
  
  for (const [tileId, tilePixels] of Object.entries(pixels)) {
    // Validate tile pixels array
    if (!Array.isArray(tilePixels)) {
      console.warn('Invalid tile pixels array', { tileId, tilePixels });
      continue;
    }
    
    for (const pixelCoords of tilePixels) {
      totalPixels++;
      
      // Validate pixel coordinates
      if (!Array.isArray(pixelCoords) || pixelCoords.length < 2) {
        console.warn('Invalid pixel coordinates', { tileId, pixelCoords });
        failedReads++;
        continue;
      }
      
      const [row, col] = pixelCoords;
      
      // Validate coordinate types
      if (typeof row !== 'number' || typeof col !== 'number') {
        console.warn('Non-numeric pixel coordinates', { tileId, row, col });
        failedReads++;
        continue;
      }
      
      const pixelData = readPixelCacheData(cacheDir, tileId, row, col);
      if (pixelData) {
        pixelsData.push(pixelData);
        successfulReads++;
      } else {
        failedReads++;
      }
    }
  }
  
  // Log statistics for debugging
  if (totalPixels > 0) {
    const successRate = Math.round((successfulReads / totalPixels) * 100);
    console.debug('Snow cover cache read statistics', { 
      successfulReads, 
      failedReads, 
      totalPixels, 
      successRate 
    });
    
    if (successRate < 50) {
      console.warn('Low success rate reading pixel cache data', { 
        successRate, 
        cacheDir,
        totalPixels 
      });
    }
  } else {
    console.warn('No pixels provided for snow cover history extraction');
  }
  
  return aggregatePixelHistories(pixelsData);
}