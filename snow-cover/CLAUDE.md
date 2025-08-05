# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This project analyzes snow cover for ski areas using VIIRS satellite data from NASA. It processes ski run geometries to extract VIIRS pixel coordinates, fetches temporal snow cover data, and maintains an efficient pixel-level cache system.

## Core Architecture

The system follows a modular pipeline architecture:

1. **Pixel Extraction Pipeline** (`src/pixel_extractor.py`):
   - Converts ski run geometries (GeoJSON) to VIIRS pixel coordinates
   - Transforms WGS84 coordinates to VIIRS Sinusoidal projection (375m resolution)
   - Maps geometries to satellite pixels using intersection logic with centroid fallback

2. **Data Fetching Pipeline** (`src/data_fetcher.py`):
   - Downloads VIIRS VNP10A1F HDF files from NASA's NSIDC DAAC
   - Uses temporary directory for HDF file caching during processing
   - Extracts snow cover percentages and cloud persistence values
   - Handles authentication via .netrc file
   - Implements sophisticated error handling (301/400/401 codes)

3. **Cache Management System** (`src/cache_manager.py`):
   - Stores pixel data in JSON files: `data/snowcover/{tile}/{row}/{col}.json`
   - Weekly granularity (every 7 days from Jan 1st)
   - Atomic updates with error code management
   - Efficient batch loading/saving per tile

4. **Orchestration Layer** (`src/fetch_snow_data.py`):
   - Coordinates the entire workflow
   - Parallel processing with configurable workers
   - Year filtering and partial processing support
   - Cache statistics and cleanup utilities

## Development Commands

```bash
# Setup environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run tests
pytest
# Run specific test markers
pytest -m unit
pytest -m integration

# Main processing workflow
python src/fetch_snow_data.py data/runs.geojson

# Check cache statistics
python src/fetch_snow_data.py data/runs.geojson --stats-only

# Process specific years
python src/fetch_snow_data.py data/runs.geojson --from-year 2024 --to-year 2024

# Enable verbose logging
python src/fetch_snow_data.py data/runs.geojson --verbose

# Fill missing temporal data for existing cached pixels (no geojson required)
python src/fetch_snow_data.py --fill-cache

# Debugging tool: Convert HDF to GeoTIFF
python scripts/hdf-to-geotiff.py input.hdf output.tif
```

## Key Technical Details

### VIIRS Specifications

- **Dataset**: NOAA/VIIRS/001/VNP10A1F (gap-filled snow cover)
- **Resolution**: 375m pixels
- **Projection**: Sinusoidal (same as MODIS)
- **Sphere radius**: 6371007.181 meters
- **Tile naming**: h##v## format (e.g., h18v04)

### Data Structure

- **Input**: `data/runs.geojson` with ski run geometries
- **Cache**: `data/snowcover/{tile}/{row}/{col}.json`
- **Format**: Raw pixel values (0-100% snow cover) with cloud persistence (0-63 days)
- **Error codes**: 301 (old missing), 400 (recent/retryable), 401 (other errors)

### Authentication

Requires NASA Earthdata credentials in `~/.netrc`:

```
machine urs.earthdata.nasa.gov
login your_username
password your_password
```

### Testing Strategy

- Unit tests for individual components
- Integration tests with mock HDF data
- Test fixtures in `tests/test_run_data.json`
- Markers: `@pytest.mark.integration`, `@pytest.mark.unit`, `@pytest.mark.slow`

## Critical Implementation Notes

1. **Coordinate Systems**: Always transform from WGS84 to VIIRS Sinusoidal before pixel calculations
2. **Pixel Coordinates**: Use [column, row] format with origin at top-left
3. **Error Handling**: 400 codes are retryable; 301 codes are permanent
4. **Memory Management**: Process one tile at a time, clean up HDF files immediately
5. **Batch Processing**: Load all pixel caches for a tile, update, then save once
6. **Cloud Persistence**: 0 = fresh data, 1-63 = days old (gap-filled)
