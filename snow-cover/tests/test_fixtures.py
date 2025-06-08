#!/usr/bin/env python3
"""
Shared test fixtures and utilities for the opensnowdata test suite.

Reduces code duplication across test files and provides common test data.
"""

import tempfile
import shutil
import json
from datetime import datetime
from pathlib import Path
import pytest

import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from data_fetcher import VIIRSDataFetcher
from pixel_extractor import VIIRSPixelExtractor
from cache_manager import PixelCacheManager
from constants import ERROR_OLD_MISSING, ERROR_RECENT_MISSING, ERROR_OTHER


@pytest.fixture
def temp_dir():
    """Create temporary directory for tests."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.fixture
def sample_geojson_file(temp_dir):
    """Create a sample GeoJSON file for testing."""
    sample_data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "id": "test_run_1",
                    "name": "Test Ski Run"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [11.0, 47.0],
                        [11.001, 47.0],
                        [11.001, 47.001],
                        [11.0, 47.001],
                        [11.0, 47.0]
                    ]]
                }
            }
        ]
    }
    
    geojson_path = Path(temp_dir) / "test_runs.geojson"
    with open(geojson_path, 'w') as f:
        json.dump(sample_data, f)
    return str(geojson_path)


@pytest.fixture
def pixel_extractor():
    """Create VIIRSPixelExtractor instance."""
    return VIIRSPixelExtractor()


@pytest.fixture
def data_fetcher(temp_dir):
    """Create VIIRSDataFetcher instance with temp directory."""
    return VIIRSDataFetcher(cache_dir=temp_dir)


@pytest.fixture
def cache_manager(temp_dir):
    """Create PixelCacheManager instance with temp directory."""
    return PixelCacheManager(cache_root=temp_dir)


@pytest.fixture
def sample_tile_pixels():
    """Sample tile and pixel coordinates for testing."""
    return [
        ("h18v04", 1500, 1000),
        ("h18v04", 1501, 1001),
        ("h19v04", 500, 500)
    ]


@pytest.fixture
def sample_dates():
    """Sample dates for testing."""
    return [
        datetime(2024, 1, 1),
        datetime(2024, 1, 8),
        datetime(2024, 2, 1)
    ]




class TestDataHelper:
    """Helper class for common test data operations."""
    
    @staticmethod
    def create_pixel_data(year: int, weeks_with_data: list = None):
        """Create sample pixel data for testing."""
        from utils import create_empty_year_data
        
        year_data = create_empty_year_data(year)
        
        if weeks_with_data:
            for week in weeks_with_data:
                if week < len(year_data.data):
                    year_data.data[week] = [85, 0]  # Snow cover value
        
        return [year_data]
    
    @staticmethod
    def create_test_geometry(geom_type="polygon"):
        """Create test geometries of different types."""
        from shapely.geometry import Polygon, LineString, MultiPolygon, Point
        
        if geom_type == "polygon":
            return Polygon([
                (11.0, 47.0),
                (11.001, 47.0),
                (11.001, 47.001),
                (11.0, 47.001),
                (11.0, 47.0)
            ])
        elif geom_type == "linestring":
            return LineString([
                (11.0, 47.0),
                (11.001, 47.001)
            ])
        elif geom_type == "point":
            return Point(11.0, 47.0)
        elif geom_type == "multipolygon":
            poly1 = Polygon([(11.0, 47.0), (11.001, 47.0), (11.001, 47.001), (11.0, 47.0)])
            poly2 = Polygon([(11.002, 47.0), (11.003, 47.0), (11.003, 47.001), (11.002, 47.0)])
            return MultiPolygon([poly1, poly2])
        else:
            raise ValueError(f"Unknown geometry type: {geom_type}")


@pytest.fixture
def test_data_helper():
    """Provide TestDataHelper instance."""
    return TestDataHelper()


def assert_pixel_coords_valid(pixel_coords):
    """Assert that pixel coordinates are valid."""
    assert isinstance(pixel_coords, list)
    for pixel in pixel_coords:
        assert isinstance(pixel, dict)
        assert 'tile' in pixel
        assert 'pixel_row' in pixel
        assert 'pixel_col' in pixel
        assert 'h_tile' in pixel
        assert 'v_tile' in pixel
        assert isinstance(pixel['pixel_row'], int)
        assert isinstance(pixel['pixel_col'], int)
        assert 0 <= pixel['pixel_row'] < 3000
        assert 0 <= pixel['pixel_col'] < 3000


def assert_cache_file_valid(cache_path):
    """Assert that a cache file is valid JSON with correct structure."""
    assert cache_path.exists()
    
    with open(cache_path, 'r') as f:
        data = json.load(f)
    
    assert isinstance(data, list)
    for year_data in data:
        assert 'year' in year_data
        assert 'data' in year_data
        assert isinstance(year_data['year'], int)
        assert isinstance(year_data['data'], list)