#!/usr/bin/env python3
"""
VIIRS data fetcher for downloading and processing snow cover tiles.

Downloads VIIRS VNP10A1F tiles and extracts snow cover values for specified pixels.
Handles error codes: 301 (old missing), 400 (recent missing), 401 (other errors).
"""

import requests
import h5py
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import time
import logging
import tempfile
from typing import List, Tuple, Dict, Optional, Set
import json
from concurrent.futures import ThreadPoolExecutor, as_completed


from constants import ERROR_OLD_MISSING, ERROR_RECENT_MISSING, ERROR_OTHER
from utils import generate_weekly_dates


class VIIRSDataFetcher:
    """Fetches and processes VIIRS snow cover data."""
    
    def __init__(self):
        """
        Initialize the VIIRS data fetcher.
        
        Uses a temporary directory for HDF file caching during processing.
        """
        self.temp_dir = tempfile.mkdtemp(prefix="viirs_")
        self.cache_dir = Path(self.temp_dir)
        
        # NSIDC DAAC endpoint for VIIRS data
        self.base_url = "https://n5eil01u.ecs.nsidc.org/VIIRS/VNP10A1F.002"
        self.session = requests.Session()
        
        # Setup logging
        self.logger = logging.getLogger(__name__)
        
        # Cutoff for old missing files (1 month)
        self.old_missing_cutoff_days = 30
    
    def _is_old_date(self, date: datetime) -> bool:
        """Check if a date is older than the cutoff for old missing files."""
        cutoff_date = datetime.now() - timedelta(days=self.old_missing_cutoff_days)
        return date < cutoff_date
    
    def get_tile_filename_pattern(self, tile: str, date: datetime) -> str:
        """
        Generate VIIRS filename pattern for a tile and date.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            date: Date for the file
        
        Returns:
            Base filename pattern
        """
        h = int(tile[1:3])
        v = int(tile[4:6])
        doy = date.timetuple().tm_yday
        year = date.year
        
        return f"VNP10A1F.A{year}{doy:03d}.h{h:02d}v{v:02d}"
    
    def find_exact_filename(self, tile: str, date: datetime) -> Optional[Tuple[str, str]]:
        """
        Find the exact filename and URL for a VIIRS file.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            date: Date for the file
        
        Returns:
            Tuple of (filename, download_url) or (None, None) if not found
        """
        try:
            # NSIDC directory structure: /VIIRS/VNP10A1F.002/YYYY.MM.DD/
            date_str = date.strftime("%Y.%m.%d")
            dir_url = f"{self.base_url}/{date_str}/"
            
            # Get base filename pattern
            base_filename = self.get_tile_filename_pattern(tile, date)
            
            response = self.session.get(dir_url, timeout=30)
            if response.status_code == 200:
                # Parse directory listing to find exact filename
                content = response.text
                import re
                pattern = rf'href="({base_filename}[^"]+\.h5)"'
                matches = re.findall(pattern, content)
                
                if matches:
                    filename = matches[0]
                    return filename, f"{dir_url}{filename}"
                else:
                    return None, None
            
            elif response.status_code == 404:
                return None, None
            
            else:
                self.logger.warning(f"HTTP {response.status_code} for {dir_url}")
                return None, None
                
        except Exception as e:
            self.logger.error(f"Error finding filename for {tile} {date}: {e}")
            return None, None
    
    def download_hdf_file(self, tile: str, date: datetime) -> Optional[Path]:
        """
        Download HDF file for a specific tile and date.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            date: Date for the file
        
        Returns:
            Path to downloaded file or None if failed
        """
        # Check if file already exists in cache
        base_filename = self.get_tile_filename_pattern(tile, date)
        cached_files = list(self.cache_dir.glob(f"{base_filename}*.h5"))
        if cached_files:
            return cached_files[0]
        
        # Find exact filename and URL
        filename, download_url = self.find_exact_filename(tile, date)
        if not filename:
            return None
        
        cache_path = self.cache_dir / filename
        if cache_path.exists():
            return cache_path
        
        try:
            # Download file with authentication (uses .netrc)
            self.logger.info(f"Downloading {filename}")
            response = self.session.get(download_url, stream=True, timeout=120)
            response.raise_for_status()
            
            # Write file to cache
            with open(cache_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            # Rate limiting
            time.sleep(0.5)
            return cache_path
            
        except Exception as e:
            self.logger.error(f"Error downloading {filename}: {e}")
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 401:
                    self.logger.error("Authentication failed. Check .netrc configuration for urs.earthdata.nasa.gov")
            return None
    
    def extract_pixel_values(self, hdf_path: Path, pixels: List[Tuple[int, int]]) -> List[Optional[int]]:
        """
        Extract snow cover values for specific pixels from HDF file.
        
        Args:
            hdf_path: Path to HDF5 file
            pixels: List of (pixel_row, pixel_col) tuples
        
        Returns:
            List of snow cover values (raw, not normalized) or None for missing/invalid
        """
        try:
            with h5py.File(hdf_path, 'r') as f:
                # VIIRS snow cover dataset path
                dataset_path = '/HDFEOS/GRIDS/VIIRS_Grid_IMG_2D/Data Fields/CGF_NDSI_Snow_Cover'
                dataset = f[dataset_path]
                shape = dataset.shape
                
                values = []
                for row, col in pixels:
                    if 0 <= row < shape[0] and 0 <= col < shape[1]:
                        # Extract raw pixel value (not normalized)
                        value = int(dataset[row, col])
                        # Store raw value (including special values like fill values)
                        values.append(value)
                    else:
                        values.append(None)
                
                return values
                
        except Exception as e:
            self.logger.error(f"Error extracting pixels from {hdf_path}: {e}")
            return [None] * len(pixels)
    
    def get_cloud_persistence_value(self, hdf_path: Path, pixels: List[Tuple[int, int]]) -> List[int]:
        """
        Extract cloud persistence values for pixels from HDF file.
        
        Args:
            hdf_path: Path to HDF5 file
            pixels: List of (pixel_row, pixel_col) tuples
        
        Returns:
            List of cloud persistence values (0 = today, 1 = yesterday, etc.)
        """
        try:
            with h5py.File(hdf_path, 'r') as f:
                # Cloud persistence dataset path
                dataset_path = '/HDFEOS/GRIDS/VIIRS_Grid_IMG_2D/Data Fields/Cloud_Persistence'
                if dataset_path in f:
                    dataset = f[dataset_path]
                    shape = dataset.shape
                    
                    values = []
                    for row, col in pixels:
                        if 0 <= row < shape[0] and 0 <= col < shape[1]:
                            # Extract cloud persistence value directly
                            cloud_persistence = int(dataset[row, col])
                            values.append(cloud_persistence)
                        else:
                            values.append(0)
                    
                    return values
                else:
                    # If QA dataset not available, return 0 for all pixels
                    return [0] * len(pixels)
                    
        except Exception as e:
            self.logger.error(f"Error extracting cloud persistence from {hdf_path}: {e}")
            return [0] * len(pixels)
    
    def process_tile_date(self, tile: str, date: datetime, pixels: List[Tuple[int, int]]) -> Dict[Tuple[int, int], Tuple[int, int]]:
        """
        Process a single tile for a specific date.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            date: Date to process
            pixels: List of (pixel_row, pixel_col) tuples to extract
        
        Returns:
            Dictionary mapping pixel coordinates to (value, cloud_persistence) tuples
            Uses error codes: 301 (old missing), 400 (recent missing), 401 (other errors)
        """
        results = {}
        
        # Download HDF file
        hdf_path = self.download_hdf_file(tile, date)
        
        if hdf_path is None:
            # Determine appropriate error code based on date
            if self._is_old_date(date):
                error_code = ERROR_OLD_MISSING
            else:
                error_code = ERROR_RECENT_MISSING
            
            # Set error code for all pixels
            for pixel in pixels:
                results[pixel] = (error_code, 0)
            
            return results
        
        try:
            # Extract pixel values and cloud persistence
            pixel_values = self.extract_pixel_values(hdf_path, pixels)
            cloud_persistence_values = self.get_cloud_persistence_value(hdf_path, pixels)
            
            # Combine results
            for i, pixel in enumerate(pixels):
                value = pixel_values[i] if i < len(pixel_values) else None
                cloud_persistence = cloud_persistence_values[i] if i < len(cloud_persistence_values) else 0
                
                if value is not None:
                    results[pixel] = (value, cloud_persistence)
                else:
                    results[pixel] = (ERROR_OTHER, 0)
            
        except Exception as e:
            self.logger.error(f"Error processing {tile} for {date}: {e}")
            # Set error code for all pixels
            for pixel in pixels:
                results[pixel] = (ERROR_OTHER, 0)
        
        finally:
            # Clean up HDF file to save space
            if hdf_path and hdf_path.exists():
                try:
                    hdf_path.unlink()
                    self.logger.debug(f"Deleted HDF file: {hdf_path}")
                except Exception as e:
                    self.logger.warning(f"Could not delete HDF file {hdf_path}: {e}")
        
        return results
    
    def process_tile_dates_parallel(self, tile: str, date_to_pixels: Dict[datetime, List[Tuple[int, int]]], 
                                   max_workers: int = 4) -> Dict[datetime, Dict[Tuple[int, int], Tuple[int, int]]]:
        """
        Process multiple dates for a tile in parallel.
        
        Args:
            tile: Tile identifier (e.g., 'h18v04')
            date_to_pixels: Dictionary mapping dates to lists of pixel coordinates
            max_workers: Maximum number of parallel workers
        
        Returns:
            Dictionary mapping dates to pixel results
        """
        all_results = {}
        
        # Use ThreadPoolExecutor for I/O bound operations (downloading)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all jobs
            future_to_date = {}
            for date, pixels in date_to_pixels.items():
                future = executor.submit(self.process_tile_date, tile, date, pixels)
                future_to_date[future] = date
            
            # Collect results as they complete
            for future in as_completed(future_to_date):
                date = future_to_date[future]
                try:
                    result = future.result()
                    all_results[date] = result
                except Exception as e:
                    self.logger.error(f"Error processing {tile} for {date}: {e}")
                    # Store error results for all pixels on this date
                    pixels = date_to_pixels[date]
                    all_results[date] = {pixel: (ERROR_OTHER, 0) for pixel in pixels}
        
        return all_results
    
    def cleanup(self):
        """Cleanup resources and temporary directory."""
        import shutil
        try:
            if self.cache_dir.exists():
                shutil.rmtree(self.cache_dir)
                self.logger.debug(f"Cleaned up temporary directory: {self.cache_dir}")
        except Exception as e:
            self.logger.warning(f"Could not clean up temporary directory {self.cache_dir}: {e}")
        
        self.logger.info("VIIRS data fetcher cleanup completed")


def main():
    """Main function for standalone testing."""
    import sys
    
    if len(sys.argv) < 4:
        print("Usage: python viirs_data_fetcher.py <tile> <date> <row,col> [row,col ...]")
        print("Example: python viirs_data_fetcher.py h18v04 2024-01-01 1500,1000 1501,1001")
        sys.exit(1)
    
    # Parse arguments
    tile = sys.argv[1]
    date_str = sys.argv[2]
    date = datetime.strptime(date_str, "%Y-%m-%d")
    
    pixels = []
    for pixel_str in sys.argv[3:]:
        row, col = map(int, pixel_str.split(','))
        pixels.append((row, col))
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    
    # Test the fetcher
    fetcher = VIIRSDataFetcher()
    
    print(f"Processing tile {tile} for date {date_str}")
    print(f"Extracting {len(pixels)} pixels: {pixels}")
    
    results = fetcher.process_tile_date(tile, date, pixels)
    
    print("\nResults:")
    for pixel, (value, cloud_persistence) in results.items():
        print(f"  {pixel}: value={value}, cloud_persistence={cloud_persistence}")
    
    fetcher.cleanup()


if __name__ == "__main__":
    main()