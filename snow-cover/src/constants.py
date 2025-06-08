#!/usr/bin/env python3
"""
Shared constants for VIIRS snow cover data processing.

Contains error codes, VIIRS/MODIS grid parameters, and other shared constants.
"""

# Error codes for missing/failed data
ERROR_OLD_MISSING = 301  # No data available for old dates (>1 month)
ERROR_RECENT_MISSING = 400  # No data available for recent dates (retryable)
ERROR_OTHER = 401  # Other errors

# VIIRS/MODIS constants (official specifications)
PIXEL_SIZE = 375.0  # Exact VIIRS pixel size in meters
TILE_SIZE_METERS = 1111950.519667  # 10 degrees at equator in sinusoidal projection
PIXELS_PER_TILE = 3000
SPHERE_RADIUS = 6371007.181  # Official VIIRS sphere radius in meters
GLOBAL_WIDTH = 20015109.354 * 2  # Full global extent horizontally
GLOBAL_HEIGHT = 10007554.677 * 2  # Full global extent vertically