import {
  weekToDayAndYear,
  isValidSnowCover,
  convertPixelDataToHistory,
  aggregatePixelHistories,
  readPixelCacheData,
  getSnowCoverHistory,
  VIIRSPixelData,
  VIIRSCacheData
} from './snowCoverHistory';
import { SnowCoverHistory } from 'openskidata-format';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock console methods for testing

describe('snowCoverHistory utilities', () => {
  beforeEach(() => {
    // Mock console methods
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    jest.restoreAllMocks();
  });

  describe('weekToDayAndYear (1-indexed weeks)', () => {
    it('should convert week 1 to day 1 with no cloud persistence', () => {
      const result = weekToDayAndYear(1, 0, 2024);
      expect(result).toEqual({ year: 2024, dayOfYear: 1 });
    });

    it('should convert week 2 to day 8 with no cloud persistence', () => {
      const result = weekToDayAndYear(2, 0, 2024);
      expect(result).toEqual({ year: 2024, dayOfYear: 8 });
    });

    it('should handle cloud persistence pushing to previous year', () => {
      // Week 1 with 1 day cloud persistence = Dec 31 of previous year
      const result = weekToDayAndYear(1, 1, 2024);
      expect(result).toEqual({ year: 2023, dayOfYear: 365 }); // 2023 is not leap year
      
      // Week 1 with 5 days cloud persistence
      const result2 = weekToDayAndYear(1, 5, 2024);
      expect(result2).toEqual({ year: 2023, dayOfYear: 361 });
    });

    it('should handle cloud persistence with leap years', () => {
      // 2024 is leap year, 2023 is not
      const result = weekToDayAndYear(1, 1, 2024);
      expect(result).toEqual({ year: 2023, dayOfYear: 365 }); // 2023 has 365 days
      
      // 2020 is leap year
      const result2 = weekToDayAndYear(1, 1, 2021);
      expect(result2).toEqual({ year: 2020, dayOfYear: 366 }); // 2020 has 366 days
    });

    it('should handle cloud persistence pushing measurements within same year', () => {
      // Week 10 with 5 days cloud persistence
      const result = weekToDayAndYear(10, 5, 2024);
      expect(result).toEqual({ year: 2024, dayOfYear: 59 }); // Week 10 starts at day 64, -5 = day 59
    });

    it('should validate inputs and return null for invalid data', () => {
      expect(weekToDayAndYear(0, 0, 2024)).toBe(null); // Week too low
      expect(weekToDayAndYear(54, 0, 2024)).toBe(null); // Week too high
      expect(weekToDayAndYear(1, -1, 2024)).toBe(null); // Negative persistence not allowed
      expect(weekToDayAndYear(1, 400, 2024)).toBe(null); // Persistence too high
    });

    it('should handle edge cases with valid ranges', () => {
      // Week 52 should work
      const result = weekToDayAndYear(52, 0, 2024);
      expect(result).toBeTruthy();
      expect(result!.year).toBe(2024);
      
      // Week 53 should work for years that have it
      const result2 = weekToDayAndYear(53, 0, 2024);
      expect(result2).toBeTruthy();
      
      // Maximum reasonable cloud persistence
      const result3 = weekToDayAndYear(52, 365, 2024);
      expect(result3).toBeTruthy();
      expect(result3!.year).toBe(2023);
    });
  });

  describe('isValidSnowCover', () => {
    it('should accept valid snow cover values (0-100)', () => {
      expect(isValidSnowCover(0)).toBe(true);
      expect(isValidSnowCover(50)).toBe(true);
      expect(isValidSnowCover(85)).toBe(true);
      expect(isValidSnowCover(92)).toBe(true);
      expect(isValidSnowCover(100)).toBe(true);
    });

    it('should reject invalid snow cover codes', () => {
      expect(isValidSnowCover(301)).toBe(false); // Old missing data
      expect(isValidSnowCover(400)).toBe(false); // Recent retryable missing data
      expect(isValidSnowCover(-1)).toBe(false);
      expect(isValidSnowCover(101)).toBe(false);
      expect(isValidSnowCover(500)).toBe(false);
    });
  });

  describe('convertPixelDataToHistory', () => {
    it('should convert single pixel data correctly with 1-indexed weeks', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [85, 0],   // Week 1: day 1, 85% snow cover
              [92, 3],   // Week 2: day 5 (8-3), 92% snow cover
              [301, 0],  // Week 3: invalid data, should be skipped
              [75, 1],   // Week 4: day 21 (22-1), 75% snow cover
            ]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
      expect(history[0].days).toHaveLength(3); // Only valid data points

      // Check that days are sorted and have correct values
      const days = history[0].days;
      expect(days[0]).toEqual([1, 85, 100]);  // Day 1, 85% snow, 100% valid pixels
      expect(days[1]).toEqual([5, 92, 100]);  // Day 5, 92% snow, 100% valid pixels  
      expect(days[2]).toEqual([21, 75, 100]); // Day 21, 75% snow, 100% valid pixels
    });

    it('should handle measurements that cross year boundaries', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [85, 1],   // Week 1 with 1 day persistence = Dec 31, 2023
              [90, 0],   // Week 2: day 8, 2024
              [95, 0],   // Week 3: day 15, 2024
            ]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(2); // Should have data for both 2023 and 2024
      
      // 2023 data (from cloud persistence)
      const history2023 = history.find(h => h.year === 2023);
      expect(history2023).toBeTruthy();
      expect(history2023!.days).toHaveLength(1);
      expect(history2023!.days[0]).toEqual([365, 85, 100]); // Dec 31, 2023
      
      // 2024 data
      const history2024 = history.find(h => h.year === 2024);
      expect(history2024).toBeTruthy();
      expect(history2024!.days).toHaveLength(2);
      expect(history2024!.days[0]).toEqual([8, 90, 100]);
      expect(history2024!.days[1]).toEqual([15, 95, 100]);
    });

    it('should handle duplicate measurements for the same day (keep fresher data)', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [85, 2],   // Week 1: Jan 1 with 2 days cloud persistence = Dec 30, 2023
              [90, 0],   // Week 2: Jan 8 with 0 days cloud persistence = Jan 8, 2024
              [95, 0],   // Week 3: Jan 15 with 0 days cloud persistence = Jan 15, 2024
            ]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(2); // Should have data for 2023 and 2024
      
      // 2023 data
      const history2023 = history.find(h => h.year === 2023);
      expect(history2023).toBeTruthy();
      expect(history2023!.days).toHaveLength(1);
      expect(history2023!.days[0]).toEqual([364, 85, 100]); // Dec 30, 2023
      
      // 2024 data
      const history2024 = history.find(h => h.year === 2024);
      expect(history2024).toBeTruthy();
      expect(history2024!.days).toHaveLength(2);
      expect(history2024!.days[0]).toEqual([8, 90, 100]);  // Jan 8, 2024
      expect(history2024!.days[1]).toEqual([15, 95, 100]); // Jan 15, 2024
    });

    it('should handle malformed data gracefully', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [85, 0],           // Valid data
              [90] as any,       // Malformed: missing cloud persistence
              null as any,       // Malformed: null
              [95, 'invalid'] as any, // Malformed: non-numeric cloud persistence
              [75, 0],           // Valid data
            ]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
      expect(history[0].days).toHaveLength(2); // Only valid data points
      expect(history[0].days[0]).toEqual([1, 85, 100]);  // Week 1 = day 1
      expect(history[0].days[1]).toEqual([29, 75, 100]); // Week 5 = day 29

      // Should have logged warnings for malformed data
      expect(console.warn).toHaveBeenCalledWith(
        'Malformed week data for pixel',
        expect.objectContaining({ week: 2 })
      );
    });

    it('should handle empty or missing data arrays', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [] // Empty data
          },
          {
            year: 2023,
            data: null as any // Null data
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);
      expect(history).toHaveLength(0);
      
      // Should log debug messages for empty data
      expect(console.debug).toHaveBeenCalledWith(
        'Empty data array for pixel year',
        expect.objectContaining({ year: 2024 })
      );
    });

    it('should handle multiple years and sort correctly', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [[80, 0]]
          },
          {
            year: 2023,
            data: [[90, 0]]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(2);
      // Should be sorted by year
      expect(history[0].year).toBe(2023);
      expect(history[1].year).toBe(2024);
    });

    it('should return empty history for all invalid data', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [301, 0],  // Invalid
              [400, 0],  // Invalid
              [500, 0],  // Invalid
            ]
          }
        ]
      };

      const history = convertPixelDataToHistory(pixelData);

      expect(history).toHaveLength(0);
    });
  });

  describe('aggregatePixelHistories', () => {
    it('should handle null and undefined inputs', () => {
      expect(aggregatePixelHistories(null as any)).toEqual([]);
      expect(aggregatePixelHistories(undefined as any)).toEqual([]);
      expect(aggregatePixelHistories([])).toEqual([]);
    });

    it('should filter out invalid pixel data', () => {
      const validPixel: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [{ year: 2024, data: [[85, 0]] }]
      };
      
      const invalidPixels = [
        validPixel,
        null as any,
        { tileId: 'h12v04', row: 100, col: 200, data: null } as any,
        { tileId: 'h12v04', row: 100, col: 200, data: [] } as any,
        undefined as any
      ];

      const history = aggregatePixelHistories(invalidPixels);
      
      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
    });

    it('should aggregate multiple pixels correctly', () => {
      const pixel1: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [80, 0],  // Week 1 = Day 1, 80% snow
              [90, 0],  // Week 2 = Day 8, 90% snow
            ]
          }
        ]
      };

      const pixel2: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 201,
        data: [
          {
            year: 2024,
            data: [
              [60, 0],  // Week 1 = Day 1, 60% snow
              [70, 0],  // Week 2 = Day 8, 70% snow
            ]
          }
        ]
      };

      const history = aggregatePixelHistories([pixel1, pixel2]);

      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
      expect(history[0].days).toHaveLength(2);

      // Check averaged values
      expect(history[0].days[0]).toEqual([1, 70, 100]); // (80+60)/2 = 70, 2/2 = 100%
      expect(history[0].days[1]).toEqual([8, 80, 100]); // (90+70)/2 = 80, 2/2 = 100%
    });

    it('should handle partial pixel coverage correctly', () => {
      const pixel1: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [80, 0],  // Week 1 = Day 1, 80% snow
              [90, 0],  // Week 2 = Day 8, 90% snow
            ]
          }
        ]
      };

      const pixel2: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 201,
        data: [
          {
            year: 2024,
            data: [
              [60, 0],  // Week 1 = Day 1, 60% snow
              [301, 0], // Week 2 = Day 8, invalid data
            ]
          }
        ]
      };

      const pixel3: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 202,
        data: [
          {
            year: 2024,
            data: [
              [301, 0], // Week 1 = Day 1, invalid data
              [70, 0],  // Week 2 = Day 8, 70% snow
            ]
          }
        ]
      };

      const history = aggregatePixelHistories([pixel1, pixel2, pixel3]);

      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
      expect(history[0].days).toHaveLength(2);

      // Day 1: pixel1(80) + pixel2(60), 2/3 = 67%
      expect(history[0].days[0]).toEqual([1, 70, 67]); // (80+60)/2 = 70, 2/3 ≈ 67%
      
      // Day 8: pixel1(90) + pixel3(70), 2/3 = 67%
      expect(history[0].days[1]).toEqual([8, 80, 67]); // (90+70)/2 = 80, 2/3 ≈ 67%
    });

    it('should prevent duplicate pixel measurements on same day', () => {
      const pixel1: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [80, 0],  // Week 1 = Day 1, no cloud persistence
              [85, 7],  // Week 2 = Day 1 (8-7), same day as above, 7 days cloud persistence
            ]
          }
        ]
      };

      const history = aggregatePixelHistories([pixel1]);

      // Should only have one measurement for day 1 (the fresher one: cloud persistence 0 < 7)
      expect(history).toHaveLength(1);
      expect(history[0].days).toHaveLength(1);
      expect(history[0].days[0]).toEqual([1, 80, 100]); // Should keep the fresher measurement (0 cloud persistence)
    });

    it('should validate year ranges', () => {
      const pixelData: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          { year: 1800, data: [[85, 0]] }, // Too old
          { year: 2024, data: [[90, 0]] }, // Valid
          { year: 2200, data: [[95, 0]] }, // Too future
        ]
      };

      const history = aggregatePixelHistories([pixelData]);
      
      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
    });

    it('should handle processing errors gracefully', () => {
      // Create pixel data that will cause errors during processing
      const problematicPixel: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              ['invalid', 'data'] as any, // This will cause processing errors
              [85, 0] // This should still work
            ]
          }
        ]
      };

      const validPixel: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 201,
        data: [{ year: 2024, data: [[90, 0]] }]
      };

      // Should not throw and should process the valid pixel
      const history = aggregatePixelHistories([problematicPixel, validPixel]);
      
      expect(history).toHaveLength(1);
      expect(history[0].year).toBe(2024);
    });

    it('should sort days within each year', () => {
      const pixel1: VIIRSPixelData = {
        tileId: 'h12v04',
        row: 100,
        col: 200,
        data: [
          {
            year: 2024,
            data: [
              [80, 0],  // Week 1 = Day 1
              [85, 0],  // Week 3 = Day 15
              [90, 0],  // Week 2 = Day 8
            ]
          }
        ]
      };

      const history = aggregatePixelHistories([pixel1]);

      expect(history).toHaveLength(1);
      expect(history[0].days).toHaveLength(3);
      
      // Should be sorted by day of year
      expect(history[0].days[0][0]).toBe(1);   // Day 1
      expect(history[0].days[1][0]).toBe(8);   // Day 8
      expect(history[0].days[2][0]).toBe(15);  // Day 15
    });
  });

  describe('readPixelCacheData', () => {
    let tempDir: string;
    
    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-cover-test-'));
    });
    
    afterEach(() => {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should read valid cache files', () => {
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      const testData = [
        { year: 2024, data: [[85, 0], [90, 1]] }
      ];
      
      fs.writeFileSync(path.join(tileDir, '200.json'), JSON.stringify(testData));
      
      const result = readPixelCacheData(tempDir, 'h12v04', 100, 200);
      
      expect(result).toBeTruthy();
      expect(result!.tileId).toBe('h12v04');
      expect(result!.row).toBe(100);
      expect(result!.col).toBe(200);
      expect(result!.data).toEqual(testData);
    });

    it('should return null for non-existent files', () => {
      const result = readPixelCacheData(tempDir, 'h12v04', 100, 999);
      expect(result).toBe(null);
    });

    it('should validate input parameters', () => {
      expect(readPixelCacheData('', 'h12v04', 100, 200)).toBe(null);
      expect(readPixelCacheData(tempDir, '', 100, 200)).toBe(null);
      expect(readPixelCacheData(tempDir, 'invalid', 100, 200)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', -1, 200)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 100, -1)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 3000, 200)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 100, 3000)).toBe(null);
      
      // Should log warnings for invalid parameters
      expect(console.warn).toHaveBeenCalledWith(
        'Invalid input parameters for reading pixel cache',
        expect.any(Object)
      );
    });

    it('should handle malformed JSON files', () => {
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      fs.writeFileSync(path.join(tileDir, '200.json'), 'invalid json');
      
      const result = readPixelCacheData(tempDir, 'h12v04', 100, 200);
      expect(result).toBe(null);
      
      // Should log error for parse failure
      expect(console.error).toHaveBeenCalledWith(
        'Failed to read or parse cache file',
        expect.any(Object)
      );
    });

    it('should handle empty files', () => {
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      fs.writeFileSync(path.join(tileDir, '200.json'), '');
      
      const result = readPixelCacheData(tempDir, 'h12v04', 100, 200);
      expect(result).toBe(null);
      
      // Should log warning for empty file
      expect(console.warn).toHaveBeenCalledWith(
        'Empty cache file',
        expect.any(Object)
      );
    });

    it('should validate data structure', () => {
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      // Invalid: not an array
      fs.writeFileSync(path.join(tileDir, '201.json'), JSON.stringify({ invalid: true }));
      
      // Invalid: missing year or data
      fs.writeFileSync(path.join(tileDir, '202.json'), JSON.stringify([{ year: 2024 }]));
      
      // Invalid: year out of range
      fs.writeFileSync(path.join(tileDir, '203.json'), JSON.stringify([{ year: 1800, data: [[85, 0]] }]));
      
      // Valid data
      fs.writeFileSync(path.join(tileDir, '204.json'), JSON.stringify([{ year: 2024, data: [[85, 0]] }]));
      
      expect(readPixelCacheData(tempDir, 'h12v04', 100, 201)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 100, 202)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 100, 203)).toBe(null);
      expect(readPixelCacheData(tempDir, 'h12v04', 100, 204)).toBeTruthy();
    });
  });

  describe('getSnowCoverHistory', () => {
    let tempDir: string;
    
    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-cover-test-'));
    });
    
    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle invalid inputs', () => {
      expect(getSnowCoverHistory('', {})).toEqual([]);
      expect(getSnowCoverHistory(tempDir, null as any)).toEqual([]);
      expect(getSnowCoverHistory(tempDir, 'invalid' as any)).toEqual([]);
      
      // Should log errors for invalid inputs
      expect(console.error).toHaveBeenCalledWith(
        'Invalid input parameters for getSnowCoverHistory',
        expect.any(Object)
      );
    });

    it('should handle malformed pixel coordinates', () => {
      const pixels = {
        'h12v04': [
          [100, 200],           // Valid
          ['invalid'] as any,   // Invalid
          [100] as any,         // Missing col
          null as any,          // Null
        ]
      };
      
      // Should not throw
      const result = getSnowCoverHistory(tempDir, pixels);
      expect(result).toEqual([]);
      
      // Should log warnings for invalid coordinates
      expect(console.warn).toHaveBeenCalledWith(
        'Invalid pixel coordinates',
        expect.any(Object)
      );
    });

    it('should integrate with real cache files', () => {
      // Create test cache files
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      const testData1 = [{ year: 2024, data: [[85, 0], [90, 1]] }];
      const testData2 = [{ year: 2024, data: [[80, 0], [95, 0]] }];
      
      fs.writeFileSync(path.join(tileDir, '200.json'), JSON.stringify(testData1));
      fs.writeFileSync(path.join(tileDir, '201.json'), JSON.stringify(testData2));
      
      const pixels: Record<string, [number, number][]> = {
        'h12v04': [[100, 200], [100, 201]]
      };
      
      const result = getSnowCoverHistory(tempDir, pixels);
      
      expect(result).toHaveLength(1);
      expect(result[0].year).toBe(2024);
      expect(result[0].days.length).toBeGreaterThan(0);
      
      // Should log debug info about read statistics
      expect(console.debug).toHaveBeenCalledWith(
        'Snow cover cache read statistics',
        expect.objectContaining({
          successfulReads: 2,
          totalPixels: 2,
          successRate: 100
        })
      );
    });

    it('should warn about low success rates', () => {
      // Create only one cache file out of many requested pixels
      const tileDir = path.join(tempDir, 'h12v04', '100');
      fs.mkdirSync(tileDir, { recursive: true });
      
      const testData = [{ year: 2024, data: [[85, 0]] }];
      fs.writeFileSync(path.join(tileDir, '200.json'), JSON.stringify(testData));
      
      const pixels: Record<string, [number, number][]> = {
        'h12v04': [[100, 200], [100, 201], [100, 202], [100, 203], [100, 204]]
      };
      
      getSnowCoverHistory(tempDir, pixels);
      
      // Should warn about low success rate (20% = 1/5)
      expect(console.warn).toHaveBeenCalledWith(
        'Low success rate reading pixel cache data',
        expect.objectContaining({
          successRate: 20
        })
      );
    });
  });
});