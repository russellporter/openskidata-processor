#!/usr/bin/env python3
"""
SQLite-based archive for VIIRS snow cover data.

Provides cross-language compatibility with the Node.js processing pipeline.
Historical satellite data is stored permanently (no TTL).
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict

from sqlite_cache import SQLiteCacheSync
from utils import calculate_week_index, create_empty_year_data


@dataclass
class PixelWeeklyData:
    """Represents weekly snow cover data for a pixel."""
    year: int
    data: List[List[int]]  # List of [pixel_value, cloud_persistence] pairs


class SnowCoverSQLiteArchive:
    """SQLite-based archive for VIIRS snow cover data."""
    
    # No TTL: Historical satellite data never changes
    ARCHIVE_TTL_MS = 0  # Infinite - this is an archive, not a cache
    
    def __init__(self, archive_file: str = "./cache/snow-cover-archive.db"):
        """
        Initialize the snow cover SQLite archive.
        
        Args:
            archive_file: Path to the SQLite database file
        """
        self.archive = SQLiteCacheSync(archive_file, self.ARCHIVE_TTL_MS)
        self.logger = logging.getLogger(__name__)
        self._initialized = False
    
    def initialize(self):
        """Initialize the archive database."""
        self.archive.initialize()
        self._initialized = True
        self.logger.debug("Snow cover SQLite archive initialized")
    
    def _create_pixel_key(self, tile: str, pixel_row: int, pixel_col: int) -> str:
        """
        Create an archive key for a specific pixel.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            pixel_row: Pixel row coordinate  
            pixel_col: Pixel column coordinate
            
        Returns:
            Archive key string
        """
        return f"snow_cover:{tile}:{pixel_row}:{pixel_col}"
    
    def load_pixel_data(self, tile: str, pixel_row: int, pixel_col: int) -> List[PixelWeeklyData]:
        """
        Load existing data for a pixel from archive.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
        
        Returns:
            List of PixelWeeklyData objects, sorted by year
        """
        if not self._initialized:
            raise RuntimeError("Archive not initialized")
        
        archive_key = self._create_pixel_key(tile, pixel_row, pixel_col)
        archived_data = self.archive.get(archive_key)
        
        if archived_data is None:
            return []
        
        try:
            # Convert archived data back to PixelWeeklyData objects
            pixel_data = []
            for year_data in archived_data:
                pixel_data.append(PixelWeeklyData(
                    year=year_data['year'],
                    data=year_data['data']
                ))
            
            # Sort by year
            pixel_data.sort(key=lambda x: x.year)
            return pixel_data
            
        except Exception as e:
            self.logger.error(f"Error parsing archived pixel data for {tile}:{pixel_row},{pixel_col}: {e}")
            # Delete corrupted entry
            self.archive.delete(archive_key)
            return []
    
    def save_pixel_data(self, tile: str, pixel_row: int, pixel_col: int, 
                       pixel_data: List[PixelWeeklyData]):
        """
        Save pixel data to archive.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
            pixel_data: List of PixelWeeklyData objects to save
        """
        if not self._initialized:
            raise RuntimeError("Archive not initialized")
        
        archive_key = self._create_pixel_key(tile, pixel_row, pixel_col)
        
        # Convert PixelWeeklyData objects to serializable format
        serializable_data = []
        for year_data in pixel_data:
            serializable_data.append(asdict(year_data))
        
        self.archive.set(archive_key, serializable_data)
    
    def get_missing_weeks_for_pixel(self, tile: str, pixel_row: int, pixel_col: int,
                                   start_date: datetime, end_date: datetime) -> List[Tuple[datetime, int]]:
        """
        Get list of missing weeks for a pixel within the specified date range.
        
        Args:
            tile: Tile identifier
            pixel_row: Pixel row coordinate
            pixel_col: Pixel column coordinate
            start_date: Start date for analysis
            end_date: End date for analysis
        
        Returns:
            List of (date, week_index) tuples for missing weeks
        """
        pixel_data = self.load_pixel_data(tile, pixel_row, pixel_col)
        
        # Create lookup for existing data
        existing_data = {}
        for year_data in pixel_data:
            existing_data[year_data.year] = year_data.data
        
        missing_weeks = []
        current_date = start_date
        
        while current_date <= end_date:
            year = current_date.year
            week_index = calculate_week_index(current_date, year)
            
            # Check if we have data for this week
            year_data = existing_data.get(year, [])
            
            # Extend data array if needed
            while len(year_data) <= week_index:
                year_data.append([None, 0])
            
            # Check if this week has data
            if (week_index < len(year_data) and 
                year_data[week_index] is not None and 
                year_data[week_index][0] is not None):
                # We have data for this week
                pass
            else:
                # Missing data for this week
                missing_weeks.append((current_date, week_index))
            
            # Move to next week
            current_date += timedelta(days=7)
        
        return missing_weeks
    
    def discover_existing_pixels(self) -> Dict[str, List[Tuple[int, int]]]:
        """
        Discover all existing cached pixels by scanning cache keys.
        
        Returns:
            Dictionary mapping tile names to lists of (pixel_row, pixel_col) tuples
        """
        # This is a limitation of the current SQLite implementation
        # We would need to add a method to list all keys with a prefix
        # For now, return empty dict - this feature would need to be implemented
        # by adding a key listing capability to SQLiteCache
        self.logger.warning("discover_existing_pixels not implemented for SQLite archive")
        return {}
    
    def get_archive_stats(self) -> Dict[str, int]:
        """
        Get archive statistics.
        
        Returns:
            Dictionary with archive statistics
        """
        try:
            total_entries = self.archive.size()
            return {
                'total_entries': total_entries,
                'archive_type': 'sqlite'
            }
        except Exception as e:
            self.logger.error(f"Error getting archive stats: {e}")
            return {'total_entries': 0, 'archive_type': 'sqlite'}
    
    def cleanup_old_error_codes(self, cutoff_date: datetime):
        """
        Clean up old error codes from archive.
        
        Args:
            cutoff_date: Remove error codes older than this date
        """
        # This would require iterating through all archive entries and checking their content
        # Since this is an archive without TTL, error cleanup is less important
        self.logger.info("cleanup_old_error_codes: not applicable for infinite archive")
    
    def close(self):
        """Close the archive."""
        if self._initialized:
            self.archive.close()
            self._initialized = False

