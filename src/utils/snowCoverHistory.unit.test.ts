import {
  weekToDayAndYear,
  isValidSnowCover,
  convertPixelDataToHistory,
  aggregatePixelHistories,
  VIIRSPixelData,
  VIIRSCacheData
} from './snowCoverHistory';
import { SnowCoverHistory } from 'openskidata-format';

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

    it('should validate inputs and return null for invalid data', () => {
      expect(weekToDayAndYear(0, 0, 2024)).toBe(null); // Week too low
      expect(weekToDayAndYear(54, 0, 2024)).toBe(null); // Week too high
      expect(weekToDayAndYear(1, -1, 2024)).toBe(null); // Negative persistence not allowed
      expect(weekToDayAndYear(1, 400, 2024)).toBe(null); // Persistence too high
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
  });

  describe('aggregatePixelHistories', () => {
    it('should handle null and undefined inputs', () => {
      expect(aggregatePixelHistories(null as any)).toEqual([]);
      expect(aggregatePixelHistories(undefined as any)).toEqual([]);
      expect(aggregatePixelHistories([])).toEqual([]);
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
  });

  // SQLite-based cache tests would be integration tests
  // and require actual database setup, so they're not included here.
});