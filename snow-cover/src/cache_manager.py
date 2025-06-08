#!/usr/bin/env python3
"""
Cache manager for pixel-level VIIRS snow cover data.

Manages JSON cache files with structure: data/snowcover/{tile}/{row}/{col}.json
Each file contains yearly data with weekly granularity.
"""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

from utils import calculate_week_index, format_cache_stats, create_empty_year_data


@dataclass
class PixelWeeklyData:
    """Represents weekly snow cover data for a pixel."""
    year: int
    data: List[List[int]]  # List of [pixel_value, cloud_persistence] pairs


class PixelCacheManager:
    """Manages pixel-level cache files for VIIRS snow data."""
    
    def __init__(self, cache_root: str = "data/snowcover"):
        """
        Initialize the cache manager.
        
        Args:
            cache_root: Root directory for cache files
        """
        self.cache_root = Path(cache_root)
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger(__name__)
    
    def get_pixel_cache_path(self, tile: str, pixel_row: int, pixel_col: int) -> Path:
        """
        Get the cache file path for a specific pixel.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
        
        Returns:
            Path to the pixel's cache file
        """
        return self.cache_root / tile / str(pixel_row) / f"{pixel_col}.json"
    
    def load_pixel_data(self, tile: str, pixel_row: int, pixel_col: int) -> List[PixelWeeklyData]:
        """
        Load existing data for a pixel from cache.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
        
        Returns:
            List of PixelWeeklyData objects, sorted by year
        """
        cache_path = self.get_pixel_cache_path(tile, pixel_row, pixel_col)
        
        if not cache_path.exists():
            return []
        
        try:
            with open(cache_path, 'r') as f:
                data = json.load(f)
            
            # Convert to PixelWeeklyData objects
            pixel_data = []
            for year_data in data:
                pixel_data.append(PixelWeeklyData(
                    year=year_data['year'],
                    data=year_data['data']
                ))
            
            # Sort by year
            pixel_data.sort(key=lambda x: x.year)
            return pixel_data
            
        except Exception as e:
            self.logger.error(f"Error loading pixel data from {cache_path}: {e}")
            return []
    
    def save_pixel_data(self, tile: str, pixel_row: int, pixel_col: int, 
                       pixel_data: List[PixelWeeklyData]):
        """
        Save pixel data to cache file.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
            pixel_data: List of PixelWeeklyData objects to save
        """
        cache_path = self.get_pixel_cache_path(tile, pixel_row, pixel_col)
        
        # Create directory structure
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            # Convert to JSON-serializable format
            json_data = []
            for year_data in pixel_data:
                json_data.append({
                    'year': year_data.year,
                    'data': year_data.data
                })
            
            # Sort by year
            json_data.sort(key=lambda x: x['year'])
            
            # Save as minified JSON to reduce disk space
            with open(cache_path, 'w') as f:
                json.dump(json_data, f, separators=(',', ':'))
            
            self.logger.debug(f"Saved pixel data to {cache_path}")
            
        except Exception as e:
            self.logger.error(f"Error saving pixel data to {cache_path}: {e}")
            raise
    
    def get_missing_weeks_for_pixel(self, tile: str, pixel_row: int, pixel_col: int,
                                   start_date: datetime, end_date: datetime) -> List[Tuple[datetime, int]]:
        """
        Get list of missing weeks for a pixel within a date range.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
            start_date: Start date for checking
            end_date: End date for checking
        
        Returns:
            List of (date, week_index) tuples for missing weeks
        """
        pixel_data = self.load_pixel_data(tile, pixel_row, pixel_col)
        
        # Create lookup for existing data by year and week index
        existing_data = {}
        for year_data in pixel_data:
            year = year_data.year
            if year not in existing_data:
                existing_data[year] = {}
            for week_idx, week_data in enumerate(year_data.data):
                # Only consider data that exists (not None)
                if len(week_data) >= 1 and week_data[0] is not None:
                    existing_data[year][week_idx] = week_data
        
        # Generate all expected weeks in the date range
        # Process each year independently to ensure we check all weeks 0-52
        missing_weeks = []
        
        start_year = start_date.year
        end_year = end_date.year
        
        for year in range(start_year, end_year + 1):
            # For each year, generate weeks starting from January 1st
            year_start = datetime(year, 1, 1)
            year_end = datetime(year, 12, 31)
            
            # Constrain to the requested date range
            year_range_start = max(year_start, start_date)
            year_range_end = min(year_end, end_date)
            
            # Generate all weeks for this year (0-52)
            current_date = year_start
            while current_date <= year_range_end:
                week_index = calculate_week_index(current_date, year)
                
                # Only include weeks that fall within the requested date range
                if current_date >= year_range_start:
                    # Check if this week is missing or has error codes that need retry
                    if (year not in existing_data or 
                        week_index not in existing_data[year]):
                        missing_weeks.append((current_date, week_index))
                    else:
                        # Check if we have retryable error codes (400)
                        week_data = existing_data[year][week_index]
                        if len(week_data) >= 1 and week_data[0] == 400:  # ERROR_RECENT_MISSING
                            missing_weeks.append((current_date, week_index))
                
                current_date += timedelta(days=7)
        
        return missing_weeks
    
    def update_pixel_week(self, tile: str, pixel_row: int, pixel_col: int,
                         date: datetime, value: int, cloud_persistence: int):
        """
        Update a specific week's data for a pixel.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
            date: Date of the week to update
            value: Snow cover value (raw pixel value or error code)
            cloud_persistence: Cloud persistence value
        """
        # Load existing data
        pixel_data = self.load_pixel_data(tile, pixel_row, pixel_col)
        
        # Find or create year data
        year = date.year
        year_data = None
        for data in pixel_data:
            if data.year == year:
                year_data = data
                break
        
        if year_data is None:
            # Create new year data with 53 weeks (to handle leap years)
            year_data = create_empty_year_data(year)
            pixel_data.append(year_data)
        
        # Calculate week index within the year
        week_index = calculate_week_index(date, year)
        
        # Ensure we have enough weeks in the data array
        while len(year_data.data) <= week_index:
            year_data.data.append([None, 0])
        
        # Update the specific week
        year_data.data[week_index] = [value, cloud_persistence]
        
        # Save updated data
        self.save_pixel_data(tile, pixel_row, pixel_col, pixel_data)
    
    def get_cache_stats(self) -> Dict[str, int]:
        """
        Get statistics about the cache.
        
        Returns:
            Dictionary with cache statistics
        """
        stats = {
            'total_pixels': 0,
            'total_files': 0,
            'tiles_count': 0,
            'total_size_bytes': 0
        }
        
        if not self.cache_root.exists():
            return stats
        
        # Count tiles
        tile_dirs = [d for d in self.cache_root.iterdir() if d.is_dir()]
        stats['tiles_count'] = len(tile_dirs)
        
        # Count files and calculate size
        for tile_dir in tile_dirs:
            for row_dir in tile_dir.iterdir():
                if row_dir.is_dir():
                    for json_file in row_dir.glob('*.json'):
                        stats['total_files'] += 1
                        stats['total_pixels'] += 1
                        try:
                            stats['total_size_bytes'] += json_file.stat().st_size
                        except:
                            pass
        
        return stats
    
    def cleanup_old_error_codes(self, cutoff_date: datetime, error_codes: List[int] = [400]):
        """
        Clean up old retryable error codes from cache files.
        
        Args:
            cutoff_date: Remove error codes older than this date
            error_codes: List of error codes to remove (default: [400] for recent missing)
        """
        files_updated = 0
        
        for tile_dir in self.cache_root.iterdir():
            if not tile_dir.is_dir():
                continue
                
            for row_dir in tile_dir.iterdir():
                if not row_dir.is_dir():
                    continue
                    
                for json_file in row_dir.glob('*.json'):
                    try:
                        # Parse tile, row, col from path
                        tile = tile_dir.name
                        pixel_row = int(row_dir.name)
                        pixel_col = int(json_file.stem)
                        
                        # Load and check data
                        pixel_data = self.load_pixel_data(tile, pixel_row, pixel_col)
                        modified = False
                        
                        for year_data in pixel_data:
                            year = year_data.year
                            for week_idx, week_data in enumerate(year_data.data):
                                if len(week_data) >= 1 and week_data[0] in error_codes:
                                    # Calculate date for this week
                                    week_date = datetime(year, 1, 1) + timedelta(days=week_idx * 7)
                                    
                                    if week_date < cutoff_date:
                                        # Remove old error code
                                        year_data.data[week_idx] = [None, 0]
                                        modified = True
                        
                        # Save if modified
                        if modified:
                            self.save_pixel_data(tile, pixel_row, pixel_col, pixel_data)
                            files_updated += 1
                            
                    except Exception as e:
                        self.logger.warning(f"Error cleaning up {json_file}: {e}")
        
        self.logger.info(f"Cleaned up {files_updated} cache files")


def main():
    """Main function for standalone testing."""
    import sys
    from datetime import timedelta
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    # Test the cache manager
    cache_manager = PixelCacheManager()
    
    if len(sys.argv) >= 2 and sys.argv[1] == "stats":
        # Show cache statistics
        stats = cache_manager.get_cache_stats()
        print("Cache Statistics:")
        print(format_cache_stats(stats))
        return
    
    # Test basic functionality
    tile = "h18v04"
    pixel_row = 1500
    pixel_col = 1000
    
    print(f"Testing cache for pixel {tile}:{pixel_row},{pixel_col}")
    
    # Test saving some data
    test_date = datetime(2024, 1, 1)
    cache_manager.update_pixel_week(tile, pixel_row, pixel_col, test_date, 85, 0)
    
    test_date2 = datetime(2024, 1, 8)  # One week later
    cache_manager.update_pixel_week(tile, pixel_row, pixel_col, test_date2, 92, 1)
    
    # Test loading data
    pixel_data = cache_manager.load_pixel_data(tile, pixel_row, pixel_col)
    print(f"Loaded data for {len(pixel_data)} years")
    
    for year_data in pixel_data:
        non_null_weeks = sum(1 for week in year_data.data if week[0] is not None)
        print(f"  Year {year_data.year}: {non_null_weeks} weeks with data")
    
    # Test missing weeks detection
    start_date = datetime(2024, 1, 1)
    end_date = datetime(2024, 2, 1)
    missing_weeks = cache_manager.get_missing_weeks_for_pixel(tile, pixel_row, pixel_col, start_date, end_date)
    print(f"Missing weeks in range: {len(missing_weeks)}")
    
    cache_path = cache_manager.get_pixel_cache_path(tile, pixel_row, pixel_col)
    print(f"Cache file path: {cache_path}")


if __name__ == "__main__":
    main()