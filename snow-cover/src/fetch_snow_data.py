#!/usr/bin/env python3
"""
Main script to fetch VIIRS snow cover data for ski run pixels.

Processes runs.geojson to extract unique pixels, then fetches and caches
weekly snow cover data with error handling and progress tracking.
"""

import argparse
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Set, Optional

from pixel_extractor import VIIRSPixelExtractor
from data_fetcher import VIIRSDataFetcher
from cache_manager import PixelCacheManager
from constants import ERROR_OLD_MISSING, ERROR_RECENT_MISSING, ERROR_OTHER
from utils import calculate_week_index, format_cache_stats, create_empty_year_data


class VIIRSSnowDataProcessor:
    """Main processor for VIIRS snow data integration."""
    
    def __init__(self, cache_dir: str = "data/snowcover", 
                 max_workers: int = 6, from_year: Optional[int] = None, to_year: Optional[int] = None):
        """
        Initialize the processor.
        
        Args:
            cache_dir: Directory for pixel-level JSON cache files
            max_workers: Maximum number of parallel workers for downloads
            from_year: Start year (inclusive), defaults to 2012
            to_year: End year (inclusive), defaults to current year
        """
        self.pixel_extractor = VIIRSPixelExtractor()
        self.data_fetcher = VIIRSDataFetcher()
        self.cache_manager = PixelCacheManager(cache_root=cache_dir)
        self.max_workers = max_workers
        
        self.logger = logging.getLogger(__name__)
        
        # Set date range for processing
        start_year = from_year if from_year is not None else 2012
        end_year = to_year if to_year is not None else datetime.now().year
        
        # VIIRS data starts in 2012
        self.start_date = datetime(start_year, 1, 1)
        
        # End date is December 31st of the end year, or now if it's the current year
        if end_year == datetime.now().year:
            self.end_date = datetime.now()
        else:
            self.end_date = datetime(end_year, 12, 31)
        
        self.logger.info(f"Processing date range: {self.start_date.strftime('%Y-%m-%d')} to {self.end_date.strftime('%Y-%m-%d')}")
    
    def process_runs_geojson(self, geojson_path: str) -> Dict[str, List[Tuple[int, int]]]:
        """
        Extract unique pixels from runs.geojson and group by tile.
        
        Args:
            geojson_path: Path to runs.geojson file
        
        Returns:
            Dictionary mapping tile names to lists of (pixel_row, pixel_col) tuples
        """
        self.logger.info(f"Extracting pixels from {geojson_path}")
        
        # Extract unique pixels
        unique_pixels = self.pixel_extractor.extract_unique_pixels_from_geojson(geojson_path)
        
        # Group by tile
        pixels_by_tile = self.pixel_extractor.get_pixels_by_tile(unique_pixels)
        
        self.logger.info(f"Found {len(unique_pixels)} unique pixels across {len(pixels_by_tile)} tiles")
        
        return pixels_by_tile
    
    def get_missing_data_summary(self, pixels_by_tile: Dict[str, List[Tuple[int, int]]]) -> Dict[str, int]:
        """
        Analyze missing data across all pixels to prioritize fetching.
        
        Args:
            pixels_by_tile: Dictionary mapping tiles to pixel lists
        
        Returns:
            Dictionary with summary statistics
        """
        total_pixels = sum(len(pixels) for pixels in pixels_by_tile.values())
        missing_weeks_count = 0
        
        for tile, pixels in pixels_by_tile.items():
            for pixel_row, pixel_col in pixels:
                missing_weeks = self.cache_manager.get_missing_weeks_for_pixel(
                    tile, pixel_row, pixel_col, self.start_date, self.end_date
                )
                missing_weeks_count += len(missing_weeks)
        
        return {
            'total_pixels': total_pixels,
            'total_missing_weeks': missing_weeks_count,
            'tiles_count': len(pixels_by_tile)
        }
    
    def process_tile(self, tile: str, pixels: List[Tuple[int, int]]) -> Dict[str, int]:
        """
        Process all missing data for a single tile using batched approach.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            pixels: List of (pixel_row, pixel_col) tuples
        
        Returns:
            Dictionary with processing statistics
        """
        self.logger.info(f"Processing tile {tile} with {len(pixels)} pixels")
        
        # Step 1: Determine all missing weeks for all pixels in this tile
        self.logger.info(f"  Step 1: Analyzing missing data for {len(pixels)} pixels")
        all_missing_weeks = set()
        pixel_missing_weeks = {}
        
        for pixel_row, pixel_col in pixels:
            missing_weeks = self.cache_manager.get_missing_weeks_for_pixel(
                tile, pixel_row, pixel_col, self.start_date, self.end_date
            )
            pixel_missing_weeks[(pixel_row, pixel_col)] = missing_weeks
            all_missing_weeks.update(date for date, _ in missing_weeks)
        
        if not all_missing_weeks:
            self.logger.info(f"No missing data for tile {tile}")
            return {'processed_weeks': 0, 'updated_pixels': 0, 'errors': 0}
        
        sorted_dates = sorted(all_missing_weeks)
        self.logger.info(f"  Found {len(sorted_dates)} dates needing data")
        
        # Step 2: Build date->pixels mapping for efficient processing
        date_to_pixels = {}
        for date in sorted_dates:
            pixels_for_date = []
            for pixel_row, pixel_col in pixels:
                missing_weeks = pixel_missing_weeks.get((pixel_row, pixel_col), [])
                if any(missing_date == date for missing_date, _ in missing_weeks):
                    pixels_for_date.append((pixel_row, pixel_col))
            
            if pixels_for_date:
                date_to_pixels[date] = pixels_for_date
        
        # Step 3: Fetch all data in parallel
        self.logger.info(f"  Step 2: Fetching data for {len(date_to_pixels)} dates in parallel (workers: {self.max_workers})")
        all_results = self.data_fetcher.process_tile_dates_parallel(tile, date_to_pixels, max_workers=self.max_workers)
        
        stats = {'processed_weeks': len(all_results), 'updated_pixels': 0, 'errors': 0}
        
        # Count errors
        for date, date_results in all_results.items():
            for pixel, (value, cloud_persistence) in date_results.items():
                if value in [ERROR_OLD_MISSING, ERROR_RECENT_MISSING, ERROR_OTHER]:
                    stats['errors'] += 1
        
        # Step 4: Group results by pixel and batch update all JSON files
        self.logger.info(f"  Step 3: Updating cache files for {len(pixels)} pixels")
        pixel_updates = {}  # {(pixel_row, pixel_col): [(date, value, cloud_persistence), ...]}
        
        for date, date_results in all_results.items():
            for (pixel_row, pixel_col), (value, cloud_persistence) in date_results.items():
                if (pixel_row, pixel_col) not in pixel_updates:
                    pixel_updates[(pixel_row, pixel_col)] = []
                pixel_updates[(pixel_row, pixel_col)].append((date, value, cloud_persistence))
        
        # Batch update all pixel cache files
        for (pixel_row, pixel_col), updates in pixel_updates.items():
            try:
                # Load existing data once
                pixel_data = self.cache_manager.load_pixel_data(tile, pixel_row, pixel_col)
                
                # Apply all updates for this pixel
                for date, value, cloud_persistence in updates:
                    # Find or create year data
                    year = date.year
                    year_data = None
                    for data in pixel_data:
                        if data.year == year:
                            year_data = data
                            break
                    
                    if year_data is None:
                        # Create new year data with 53 weeks
                        year_data = create_empty_year_data(year)
                        pixel_data.append(year_data)
                    
                    # Calculate week index and update
                    week_index = calculate_week_index(date, year)
                    
                    # Ensure we have enough weeks in the data array
                    while len(year_data.data) <= week_index:
                        year_data.data.append([None, 0])
                    
                    year_data.data[week_index] = [value, cloud_persistence]
                    stats['updated_pixels'] += 1
                
                # Save updated data once per pixel
                self.cache_manager.save_pixel_data(tile, pixel_row, pixel_col, pixel_data)
                
            except Exception as e:
                self.logger.error(f"Error updating cache for pixel {tile}:{pixel_row},{pixel_col}: {e}")
                stats['errors'] += 1
        
        self.logger.info(f"  Completed tile {tile}: {stats}")
        return stats
    
    def run(self, geojson_path: Optional[str] = None, max_tiles: Optional[int] = None, 
           fill_cache_mode: bool = False) -> bool:
        """
        Run the complete VIIRS snow data fetching process.
        
        Args:
            geojson_path: Path to runs.geojson file (optional if fill_cache_mode=True)
            max_tiles: Maximum number of tiles to process (for testing)
            fill_cache_mode: If True, discover existing pixels instead of processing geojson
        
        Returns:
            True if successful, False otherwise
        """
        try:
            # Step 1: Get pixels either from runs.geojson or existing cache
            if fill_cache_mode:
                self.logger.info("Discovering existing cached pixels")
                pixels_by_tile = self.cache_manager.discover_existing_pixels()
            else:
                if geojson_path is None:
                    raise ValueError("geojson_path is required when not in fill_cache_mode")
                pixels_by_tile = self.process_runs_geojson(geojson_path)
            
            if not pixels_by_tile:
                self.logger.error("No pixels found in GeoJSON file")
                return False
            
            # Step 2: Analyze missing data
            missing_summary = self.get_missing_data_summary(pixels_by_tile)
            self.logger.info(f"Missing data summary: {missing_summary}")
            
            if missing_summary['total_missing_weeks'] == 0:
                self.logger.info("All data is already cached - nothing to fetch")
                return True
            
            # Step 3: Process each tile
            tiles_to_process = list(pixels_by_tile.keys())
            if max_tiles:
                tiles_to_process = tiles_to_process[:max_tiles]
                self.logger.info(f"Limiting processing to {max_tiles} tiles for testing")
            
            total_stats = {'processed_weeks': 0, 'updated_pixels': 0, 'errors': 0}
            
            for i, tile in enumerate(tiles_to_process):
                self.logger.info(f"\n=== Processing tile {i+1}/{len(tiles_to_process)}: {tile} ===")
                
                pixels = pixels_by_tile[tile]
                tile_stats = self.process_tile(tile, pixels)
                
                # Accumulate statistics
                for key in total_stats:
                    total_stats[key] += tile_stats[key]
                
                self.logger.info(f"Tile {tile} completed: {tile_stats}")
            
            # Step 4: Final summary
            self.logger.info(f"\n=== Processing Complete ===")
            self.logger.info(f"Total statistics: {total_stats}")
            
            # Show cache statistics
            cache_stats = self.cache_manager.get_cache_stats()
            self.logger.info(f"Cache statistics: {cache_stats}")
            
            return total_stats['errors'] == 0
            
        except Exception as e:
            self.logger.error(f"Error in main processing: {e}")
            return False
        
        finally:
            # Cleanup
            self.data_fetcher.cleanup()
    
    def cleanup_old_errors(self, days: int = 7):
        """
        Clean up old retryable error codes from cache.
        
        Args:
            days: Remove error codes older than this many days
        """
        cutoff_date = datetime.now() - timedelta(days=days)
        self.logger.info(f"Cleaning up error codes older than {cutoff_date}")
        self.cache_manager.cleanup_old_error_codes(cutoff_date)


def setup_logging(verbose: bool = False):
    """Setup logging configuration."""
    level = logging.DEBUG if verbose else logging.INFO
    
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )


def main():
    """Main function with argument parsing."""
    parser = argparse.ArgumentParser(
        description='Fetch VIIRS snow cover data for ski run pixels'
    )
    
    parser.add_argument(
        'geojson_path',
        nargs='?',
        help='Path to runs.geojson file (optional with --fill-cache)'
    )
    
    parser.add_argument(
        '--fill-cache',
        action='store_true',
        help='Fill missing temporal data for existing cached pixels (no geojson required)'
    )
    
    parser.add_argument(
        '--cache-dir',
        default='data/snowcover',
        help='Directory for pixel-level JSON cache files (default: data/snowcover)'
    )
    
    
    parser.add_argument(
        '--max-tiles',
        type=int,
        help='Maximum number of tiles to process (for testing)'
    )
    
    parser.add_argument(
        '--cleanup-errors',
        action='store_true',
        help='Clean up old retryable error codes before processing'
    )
    
    parser.add_argument(
        '--cleanup-days',
        type=int,
        default=7,
        help='Clean up error codes older than this many days (default: 7)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )
    
    parser.add_argument(
        '--stats-only',
        action='store_true',
        help='Only show cache statistics, do not process'
    )
    
    parser.add_argument(
        '--max-workers',
        type=int,
        default=6,
        help='Maximum number of parallel workers for downloads (default: 6)'
    )
    
    parser.add_argument(
        '--from-year',
        type=int,
        help='Start year (inclusive) for processing (default: 2012)'
    )
    
    parser.add_argument(
        '--to-year',
        type=int,
        help='End year (inclusive) for processing (default: current year)'
    )
    
    args = parser.parse_args()
    
    # Setup logging
    setup_logging(args.verbose)
    logger = logging.getLogger(__name__)
    
    # Validate input file (only required if not in fill-cache mode)
    if args.fill_cache:
        if args.geojson_path:
            logger.warning("geojson_path ignored when using --fill-cache mode")
    else:
        if not args.geojson_path:
            logger.error("geojson_path is required unless using --fill-cache mode")
            sys.exit(1)
        if not Path(args.geojson_path).exists():
            logger.error(f"Input file not found: {args.geojson_path}")
            sys.exit(1)
    
    # Validate year arguments
    current_year = datetime.now().year
    if args.from_year is not None and args.from_year < 2012:
        logger.error("VIIRS data is only available from 2012 onwards")
        sys.exit(1)
    
    if args.to_year is not None and args.to_year > current_year:
        logger.error(f"Cannot process future years beyond {current_year}")
        sys.exit(1)
    
    if (args.from_year is not None and args.to_year is not None and 
        args.from_year > args.to_year):
        logger.error("from-year cannot be greater than to-year")
        sys.exit(1)
    
    # Initialize processor
    processor = VIIRSSnowDataProcessor(
        cache_dir=args.cache_dir,
        max_workers=args.max_workers,
        from_year=args.from_year,
        to_year=args.to_year
    )
    
    if args.stats_only:
        # Show statistics only
        cache_stats = processor.cache_manager.get_cache_stats()
        print("Cache Statistics:")
        print(format_cache_stats(cache_stats))
        sys.exit(0)
    
    # Clean up old errors if requested
    if args.cleanup_errors:
        processor.cleanup_old_errors(args.cleanup_days)
    
    # Run the main processing
    if args.fill_cache:
        logger.info("Starting VIIRS snow data fill-cache process")
        success = processor.run(geojson_path=None, max_tiles=args.max_tiles, fill_cache_mode=True)
    else:
        logger.info("Starting VIIRS snow data fetch process")
        success = processor.run(args.geojson_path, args.max_tiles, fill_cache_mode=False)
    
    if success:
        logger.info("Processing completed successfully")
        sys.exit(0)
    else:
        logger.error("Processing failed")
        sys.exit(1)


if __name__ == "__main__":
    main()