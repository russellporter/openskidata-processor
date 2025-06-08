#!/usr/bin/env python3

import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from test_fixtures import (
    temp_dir, pixel_extractor, data_fetcher, cache_manager, sample_geojson_file,
    sample_tile_pixels, sample_dates, test_data_helper,
    assert_pixel_coords_valid, assert_cache_file_valid
)
from constants import ERROR_OLD_MISSING, ERROR_RECENT_MISSING


# Pixel Extractor Tests
def test_pixel_extractor_extract_from_geojson(pixel_extractor, sample_geojson_file):
    """Test basic pixel extraction from GeoJSON file."""
    unique_pixels = pixel_extractor.extract_unique_pixels_from_geojson(sample_geojson_file)
    assert len(unique_pixels) > 0
    
    # Validate pixel format
    for tile, row, col in unique_pixels:
        assert isinstance(tile, str)
        assert isinstance(row, int)
        assert isinstance(col, int)
        assert tile.startswith('h') and 'v' in tile


def test_pixel_extractor_geometry_types(pixel_extractor, test_data_helper):
    """Test pixel extraction for different geometry types."""
    for geom_type in ['polygon', 'linestring', 'point']:
        geometry = test_data_helper.create_test_geometry(geom_type)
        pixel_coords = pixel_extractor.get_geometry_pixel_coordinates(geometry)
        assert_pixel_coords_valid(pixel_coords)


def test_pixel_extractor_coordinate_transform(pixel_extractor):
    """Test coordinate transformation consistency."""
    # Test multiple points in same region
    test_points = [(11.0, 47.0), (11.001, 47.0), (11.0, 47.001)]
    
    results = []
    for lon, lat in test_points:
        x, y = pixel_extractor.transformer.transform(lon, lat)
        tile_info = pixel_extractor.sinusoidal_to_tile_and_pixel(x, y)
        results.append(tile_info)
    
    # All points should be in the same or adjacent tiles
    tiles = set(r['tile'] for r in results)
    assert len(tiles) <= 2


def test_pixel_extractor_extreme_coordinates(pixel_extractor):
    """Test pixel extraction for extreme coordinate values."""
    # Test Arctic coordinates
    arctic_result = pixel_extractor.sinusoidal_to_tile_and_pixel(0, 8000000)
    assert 'tile' in arctic_result
    
    # Test Antarctic coordinates  
    antarctic_result = pixel_extractor.sinusoidal_to_tile_and_pixel(0, -8000000)
    assert 'tile' in antarctic_result


def test_pixel_extractor_multigeometry(pixel_extractor, test_data_helper):
    """Test pixel extraction for MultiPolygon and MultiLineString."""
    multipolygon = test_data_helper.create_test_geometry("multipolygon")
    pixel_coords = pixel_extractor.get_geometry_pixel_coordinates(multipolygon)
    assert_pixel_coords_valid(pixel_coords)
    assert len(pixel_coords) > 0


def test_pixel_extractor_geometry_sizes(pixel_extractor, test_data_helper):
    """Test pixel extraction for very small and large geometries."""
    # Small geometry (should use centroid fallback)
    small_geom = test_data_helper.create_test_geometry("point")
    small_pixels = pixel_extractor.get_geometry_pixel_coordinates(small_geom)
    assert len(small_pixels) >= 1  # At least centroid pixel
    
    # Regular polygon
    polygon = test_data_helper.create_test_geometry("polygon")
    polygon_pixels = pixel_extractor.get_geometry_pixel_coordinates(polygon)
    assert_pixel_coords_valid(polygon_pixels)


def test_pixel_extractor_empty_geojson(pixel_extractor, temp_dir):
    """Test pixel extraction from empty GeoJSON."""
    import json
    
    empty_geojson = {"type": "FeatureCollection", "features": []}
    test_file = Path(temp_dir) / "empty.geojson"
    with open(test_file, 'w') as f:
        json.dump(empty_geojson, f)
    
    unique_pixels = pixel_extractor.extract_unique_pixels_from_geojson(str(test_file))
    assert len(unique_pixels) == 0


# Cache Manager Tests
def test_cache_manager_save_and_load(cache_manager, sample_tile_pixels, test_data_helper):
    """Test cache save and load operations."""
    tile, pixel_row, pixel_col = sample_tile_pixels[0]
    
    # Create and save test data
    pixel_data = test_data_helper.create_pixel_data(2024, [0, 1, 2])
    cache_manager.save_pixel_data(tile, pixel_row, pixel_col, pixel_data)
    
    # Verify cache file exists
    cache_path = cache_manager.get_pixel_cache_path(tile, pixel_row, pixel_col)
    assert_cache_file_valid(cache_path)
    
    # Load and verify data
    loaded_data = cache_manager.load_pixel_data(tile, pixel_row, pixel_col)
    assert len(loaded_data) == 1
    assert loaded_data[0].year == 2024


def test_cache_manager_missing_weeks(cache_manager, sample_tile_pixels, sample_dates):
    """Test cache manager missing weeks detection."""
    tile, pixel_row, pixel_col = sample_tile_pixels[0]
    start_date, end_date = sample_dates[0], sample_dates[-1]
    
    # Initially all weeks should be missing
    missing_weeks = cache_manager.get_missing_weeks_for_pixel(
        tile, pixel_row, pixel_col, start_date, end_date
    )
    assert len(missing_weeks) > 0
    
    # Add data and verify reduction in missing weeks
    cache_manager.update_pixel_week(tile, pixel_row, pixel_col, start_date, 85, 0)
    missing_weeks_after = cache_manager.get_missing_weeks_for_pixel(
        tile, pixel_row, pixel_col, start_date, end_date
    )
    assert len(missing_weeks_after) < len(missing_weeks)


# Data Fetcher Tests
def test_data_fetcher_filename_patterns(data_fetcher, sample_dates):
    """Test data fetcher filename pattern generation."""
    for date in sample_dates:
        pattern = data_fetcher.get_tile_filename_pattern("h18v04", date)
        assert pattern.startswith("VNP10A1F.A")
        assert "h18v04" in pattern


def test_data_fetcher_date_classification(data_fetcher):
    """Test data fetcher old date classification."""
    from datetime import datetime, timedelta
    
    old_date = datetime.now() - timedelta(days=60)
    recent_date = datetime.now() - timedelta(days=10)
    
    assert data_fetcher._is_old_date(old_date)
    assert not data_fetcher._is_old_date(recent_date)


# Integration Tests
def test_integration_full_workflow(pixel_extractor, cache_manager, sample_geojson_file):
    """Test simplified end-to-end workflow."""
    # Extract pixels
    unique_pixels = pixel_extractor.extract_unique_pixels_from_geojson(sample_geojson_file)
    assert len(unique_pixels) > 0
    
    # Group by tile
    pixels_by_tile = pixel_extractor.get_pixels_by_tile(unique_pixels)
    assert len(pixels_by_tile) > 0
    
    # Test cache operations for each tile
    for tile, pixels in pixels_by_tile.items():
        for pixel_row, pixel_col in pixels[:2]:  # Test first 2 pixels only
            # Check missing weeks
            from datetime import datetime
            start_date = datetime(2024, 1, 1)
            end_date = datetime(2024, 1, 31)
            
            missing_weeks = cache_manager.get_missing_weeks_for_pixel(
                tile, pixel_row, pixel_col, start_date, end_date
            )
            assert isinstance(missing_weeks, list)
            break  # Only test first tile