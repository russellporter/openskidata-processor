#!/usr/bin/env python3
"""
VIIRS pixel coordinate extractor for geometric data.

Extracts unique VIIRS pixel coordinates from GeoJSON geometries for snow cover analysis.
"""

import json
import geopandas as gpd
from shapely.geometry import Polygon, LineString
from shapely.ops import transform
import pyproj
from typing import List, Dict, Set, Tuple, Any
from pathlib import Path

from constants import (
    PIXEL_SIZE, TILE_SIZE_METERS, PIXELS_PER_TILE, SPHERE_RADIUS,
    GLOBAL_WIDTH, GLOBAL_HEIGHT
)
from utils import validate_file_exists


class VIIRSPixelExtractor:
    """Extract VIIRS pixel coordinates from geometric features."""
    
    def __init__(self):
        """Initialize the pixel extractor with coordinate transformations."""
        self.transformer = self._setup_coordinate_transforms()
    
    def _setup_coordinate_transforms(self):
        """Set up coordinate transformation from WGS84 to Sinusoidal projection."""
        # WGS84 (input coordinate system)
        wgs84 = pyproj.CRS('EPSG:4326')
        
        # Sinusoidal projection used by VIIRS/MODIS
        sinusoidal = pyproj.CRS.from_proj4(
            f'+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R={SPHERE_RADIUS} +units=m +no_defs'
        )
        
        # Create transformer
        return pyproj.Transformer.from_crs(wgs84, sinusoidal, always_xy=True)
    
    def sinusoidal_to_tile_and_pixel(self, x: float, y: float) -> Dict[str, Any]:
        """
        Convert sinusoidal coordinates to VIIRS tile and pixel coordinates.
        
        Args:
            x: X coordinate in sinusoidal projection (meters)
            y: Y coordinate in sinusoidal projection (meters)
        
        Returns:
            Dictionary with tile info and pixel coordinates
        """
        # Calculate which tile this falls in using standard MODIS/VIIRS grid
        h_tile = int((x + GLOBAL_WIDTH / 2) / TILE_SIZE_METERS)
        v_tile = int((GLOBAL_HEIGHT / 2 - y) / TILE_SIZE_METERS)
        
        # Ensure tile indices are within valid range (MODIS/VIIRS standard)
        h_tile = max(0, min(35, h_tile))
        v_tile = max(0, min(17, v_tile))
        
        # Calculate tile bounds using standard grid
        tile_left = h_tile * TILE_SIZE_METERS - GLOBAL_WIDTH / 2
        tile_top = GLOBAL_HEIGHT / 2 - v_tile * TILE_SIZE_METERS
        
        # Calculate pixel within tile (0-2999)
        col = int((x - tile_left) / PIXEL_SIZE)
        row = int((tile_top - y) / PIXEL_SIZE)
        
        # Ensure pixel coordinates are within tile bounds
        col = max(0, min(PIXELS_PER_TILE - 1, col))
        row = max(0, min(PIXELS_PER_TILE - 1, row))
        
        return {
            'tile': f'h{h_tile:02d}v{v_tile:02d}',
            'h_tile': h_tile,
            'v_tile': v_tile,
            'pixel_col': col,
            'pixel_row': row,
            'sinusoidal_x': x,
            'sinusoidal_y': y
        }
    
    def get_geometry_pixel_coordinates(self, geometry) -> List[Dict[str, Any]]:
        """
        Get all VIIRS pixel coordinates that intersect with a geometry.
        
        Args:
            geometry: Shapely geometry (Polygon or LineString) in WGS84 coordinates
        
        Returns:
            List of dictionaries with tile and pixel information
        """
        # Transform geometry to sinusoidal projection
        geometry_transformed = transform(self.transformer.transform, geometry)
        
        # Get bounding box in sinusoidal coordinates
        minx, miny, maxx, maxy = geometry_transformed.bounds
        
        # Convert corners to tiles to find all potentially affected tiles
        min_info = self.sinusoidal_to_tile_and_pixel(minx, maxy)  # top-left
        max_info = self.sinusoidal_to_tile_and_pixel(maxx, miny)  # bottom-right
        
        pixel_coords = []
        processed_pixels = set()  # To avoid duplicates
        
        # Iterate through all potentially affected tiles
        for h_tile in range(min_info['h_tile'], max_info['h_tile'] + 1):
            for v_tile in range(min_info['v_tile'], max_info['v_tile'] + 1):
                # Calculate tile bounds using standard MODIS/VIIRS grid
                tile_left = h_tile * TILE_SIZE_METERS - GLOBAL_WIDTH / 2
                tile_top = GLOBAL_HEIGHT / 2 - v_tile * TILE_SIZE_METERS
                tile_right = tile_left + TILE_SIZE_METERS
                tile_bottom = tile_top - TILE_SIZE_METERS
                
                # Calculate pixel range within this tile to test
                test_min_col = max(0, int((minx - tile_left) / PIXEL_SIZE) - 1)
                test_max_col = min(PIXELS_PER_TILE - 1, int((maxx - tile_left) / PIXEL_SIZE) + 1)
                test_min_row = max(0, int((tile_top - maxy) / PIXEL_SIZE) - 1)
                test_max_row = min(PIXELS_PER_TILE - 1, int((tile_top - miny) / PIXEL_SIZE) + 1)
                
                # Test each pixel in the range
                for row in range(test_min_row, test_max_row + 1):
                    for col in range(test_min_col, test_max_col + 1):
                        # Convert pixel to sinusoidal coordinates (pixel center)
                        pixel_x = tile_left + (col + 0.5) * PIXEL_SIZE
                        pixel_y = tile_top - (row + 0.5) * PIXEL_SIZE
                        
                        # Create a pixel polygon
                        pixel_polygon = Polygon([
                            (pixel_x - PIXEL_SIZE/2, pixel_y - PIXEL_SIZE/2),
                            (pixel_x + PIXEL_SIZE/2, pixel_y - PIXEL_SIZE/2),
                            (pixel_x + PIXEL_SIZE/2, pixel_y + PIXEL_SIZE/2),
                            (pixel_x - PIXEL_SIZE/2, pixel_y + PIXEL_SIZE/2)
                        ])
                        
                        # Check if pixel intersects with the geometry
                        if geometry_transformed.intersects(pixel_polygon):
                            tile_name = f'h{h_tile:02d}v{v_tile:02d}'
                            pixel_key = f'{tile_name}_{col}_{row}'
                            
                            if pixel_key not in processed_pixels:
                                processed_pixels.add(pixel_key)
                                pixel_coords.append({
                                    'tile': tile_name,
                                    'h_tile': h_tile,
                                    'v_tile': v_tile,
                                    'pixel_col': col,
                                    'pixel_row': row,
                                    'sinusoidal_x': pixel_x,
                                    'sinusoidal_y': pixel_y
                                })
        
        # Fallback: if no pixels found, assign to centroid pixel
        if not pixel_coords:
            centroid = geometry_transformed.centroid
            centroid_info = self.sinusoidal_to_tile_and_pixel(centroid.x, centroid.y)
            pixel_coords.append({
                'tile': centroid_info['tile'],
                'h_tile': centroid_info['h_tile'],
                'v_tile': centroid_info['v_tile'],
                'pixel_col': centroid_info['pixel_col'],
                'pixel_row': centroid_info['pixel_row'],
                'sinusoidal_x': centroid.x,
                'sinusoidal_y': centroid.y
            })
        
        return pixel_coords
    
    def extract_unique_pixels_from_geojson(self, geojson_path: str) -> Set[Tuple[str, int, int]]:
        """
        Extract unique VIIRS pixel coordinates from a GeoJSON file.
        
        Args:
            geojson_path: Path to the GeoJSON file
        
        Returns:
            Set of unique pixel coordinates as (tile, pixel_row, pixel_col) tuples
        """
        # Read the GeoJSON file
        gdf = gpd.read_file(geojson_path)
        
        unique_pixels = set()
        
        for idx, row in gdf.iterrows():
            feature_id = row.get('id', f'feature_{idx}')
            feature_name = row.get('name', f'Unnamed Feature {idx}')
            geometry = row.geometry
            
            print(f"Processing feature: {feature_name} (ID: {feature_id})")
            
            # Handle different geometry types
            all_pixel_coords = []
            
            if geometry.geom_type in ['Polygon', 'LineString']:
                pixel_coords = self.get_geometry_pixel_coordinates(geometry)
                all_pixel_coords.extend(pixel_coords)
            elif geometry.geom_type in ['MultiPolygon', 'MultiLineString']:
                for sub_geometry in geometry.geoms:
                    pixel_coords = self.get_geometry_pixel_coordinates(sub_geometry)
                    all_pixel_coords.extend(pixel_coords)
            else:
                print(f"  Warning: Skipping unsupported geometry type: {geometry.geom_type}")
                continue
            
            # Add pixels to unique set
            for pixel in all_pixel_coords:
                unique_pixels.add((pixel['tile'], pixel['pixel_row'], pixel['pixel_col']))
            
            print(f"  Found {len(all_pixel_coords)} VIIRS pixels")
        
        print(f"\nTotal unique pixels across all features: {len(unique_pixels)}")
        
        return unique_pixels
    
    def get_pixels_by_tile(self, unique_pixels: Set[Tuple[str, int, int]]) -> Dict[str, List[Tuple[int, int]]]:
        """
        Group unique pixels by tile for efficient processing.
        
        Args:
            unique_pixels: Set of unique pixel coordinates as (tile, pixel_row, pixel_col) tuples
        
        Returns:
            Dictionary mapping tile names to lists of (pixel_row, pixel_col) tuples
        """
        pixels_by_tile = {}
        
        for tile, pixel_row, pixel_col in unique_pixels:
            if tile not in pixels_by_tile:
                pixels_by_tile[tile] = []
            pixels_by_tile[tile].append((pixel_row, pixel_col))
        
        return pixels_by_tile


def main():
    """Main function for standalone testing."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python viirs_pixel_extractor.py <input.geojson>")
        sys.exit(1)
    
    geojson_path = sys.argv[1]
    
    validate_file_exists(geojson_path)
    
    # Extract unique pixels
    extractor = VIIRSPixelExtractor()
    unique_pixels = extractor.extract_unique_pixels_from_geojson(geojson_path)
    
    # Group by tile
    pixels_by_tile = extractor.get_pixels_by_tile(unique_pixels)
    
    # Print summary
    print(f"\nPixel summary:")
    print(f"- Total unique pixels: {len(unique_pixels)}")
    print(f"- Tiles affected: {len(pixels_by_tile)}")
    
    for tile, pixels in pixels_by_tile.items():
        print(f"  {tile}: {len(pixels)} pixels")


if __name__ == "__main__":
    main()