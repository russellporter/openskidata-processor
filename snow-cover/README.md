# VIIRS Snow Data Integration

This system integrates VIIRS snow cover data with ski run analysis. It fetches temporal snow data for pixels that intersect with ski runs and stores it in a structured, cacheable format.

**Developed by [OpenSkiMap.org](https://openskimap.org) - Open source ski area data and analysis tools.**

## Overview

The system processes `runs.geojson` files to:
1. Extract unique VIIRS pixel coordinates that intersect with ski run geometries
2. Fetch weekly snow cover data from VIIRS VNP10A1F tiles
3. Cache data at the pixel level with error handling
4. Store raw pixel values (not normalized) with weekly granularity

## Key Features

- **Pixel-level caching**: `data/snowcover/{tile}/{row}/{col}.json`
- **Weekly granularity**: Starting Jan 1st, every 7 days
- **Raw pixel values**: No normalization to 0-100 range
- **Error codes**: 301 (old missing), 400 (recent missing), 401 (other errors)
- **Efficient processing**: One tile at a time with automatic cleanup
- **Retryable errors**: 400 codes can be retried later

## Installation

```bash
# Install dependencies
pip install -r requirements.txt
```

## Authentication Setup

For VIIRS data access, create a `.netrc` file in your home directory:

```
machine urs.earthdata.nasa.gov
login your_username
password your_password
```

Register at https://urs.earthdata.nasa.gov/ if you don't have an account.

## Usage

### Basic Usage

```bash
# Process runs.geojson and fetch missing snow data
python fetch_snow_data.py data/runs.geojson
```

### Advanced Options

```bash
# Specify custom cache directories
python fetch_snow_data.py data/runs.geojson \
  --cache-dir custom/snowcover \
  --hdf-cache-dir custom/viirs_cache

# Process only first 2 tiles (for testing)
python fetch_snow_data.py data/runs.geojson --max-tiles 2

# Use more parallel workers for faster downloads
python fetch_snow_data.py data/runs.geojson --max-workers 6

# Process only specific years (inclusive)
python fetch_snow_data.py data/runs.geojson --from-year 2020 --to-year 2023

# Process only 2024 data
python fetch_snow_data.py data/runs.geojson --from-year 2024 --to-year 2024

# Clean up old retryable errors before processing
python fetch_snow_data.py data/runs.geojson --cleanup-errors

# Show cache statistics only
python fetch_snow_data.py data/runs.geojson --stats-only

# Enable verbose logging
python fetch_snow_data.py data/runs.geojson --verbose
```

### Module Usage

You can also use individual modules:

```python
# Extract pixels from GeoJSON
from pixel_extractor import VIIRSPixelExtractor

extractor = VIIRSPixelExtractor()
unique_pixels = extractor.extract_unique_pixels_from_geojson("data/runs.geojson")
pixels_by_tile = extractor.get_pixels_by_tile(unique_pixels)

# Fetch data for specific pixels
from data_fetcher import VIIRSDataFetcher
from datetime import datetime

fetcher = VIIRSDataFetcher()
results = fetcher.process_tile_date("h18v04", datetime(2024, 1, 8), [(1500, 1000)])

# Manage pixel cache
from cache_manager import PixelCacheManager

cache_manager = PixelCacheManager()
cache_manager.update_pixel_week("h18v04", 1500, 1000, datetime(2024, 1, 8), 85, 0)
```

## Output Format

Each pixel cache file contains JSON data:

```json
[
  {
    "year": 2024,
    "data": [
      [85, 0],    // Week 0: 85% snow cover, 0 days cloud persistence (fresh data)
      [92, 3],    // Week 1: 92% snow cover, 3 days cloud persistence (3-day-old data)  
      [301, 0],   // Week 2: No data available (old missing)
      [400, 0]    // Week 3: No data available (recent, retryable)
    ]
  }
]
```

### Cloud Persistence Values

Cloud persistence indicates how old the snow cover data is:
- **0**: Data from the same day (fresh)
- **1-63**: Data is 1-63 days old (gap-filled from previous observations)
- Higher values indicate older gap-filled data

## Error Codes

- **301**: No data available for dates older than 1 month (cached permanently)
- **400**: No data available for recent dates (retryable)
- **401**: Other errors occurred during processing

## Performance

- **Batched processing**: Analyzes all missing data per tile first, then fetches in parallel
- **Parallel downloads**: Uses configurable workers (default: 3) for concurrent VIIRS downloads  
- **Efficient caching**: Loads/saves pixel JSON files only once per tile processing
- **Memory management**: Downloads and deletes HDF files immediately after processing
- **Smart caching**: Avoids repeated requests for known missing files
- **Weekly sampling**: Balances data coverage and storage requirements

## Testing

Run the test suite:

```bash
cd tests
python test_viirs_integration.py
```

## File Structure

```
pixel_extractor.py          # Extract VIIRS pixels from geometries
data_fetcher.py             # Download and process VIIRS tiles
cache_manager.py            # Manage pixel-level JSON cache
fetch_snow_data.py          # Main orchestration script
tests/
  test_viirs_integration.py # Comprehensive test suite
  test_run_data.json        # Test data
```

## Integration with openskidata-processor

This system is designed to run after your main openskidata-processor has created the `runs.geojson` file:

1. Run your main processor to generate `runs.geojson`
2. Run this VIIRS integration: `python fetch_snow_data.py data/runs.geojson`
3. Snow data is now cached and ready for analysis

The pixel-level cache persists between runs, so subsequent executions only fetch missing data.

## Common Use Cases

### Catching Up on Historical Data
```bash
# Process only 2020-2022 data
python fetch_snow_data.py data/runs.geojson --from-year 2020 --to-year 2022

# Process recent years with more workers for speed
python fetch_snow_data.py data/runs.geojson --from-year 2023 --max-workers 6
```

### Daily/Regular Processing
```bash
# Process only current year (typical for daily runs)
python fetch_snow_data.py data/runs.geojson --from-year 2025

# Process all available data (initial setup)
python fetch_snow_data.py data/runs.geojson
```

### Development and Testing
```bash
# Test with limited data (one year, one tile)
python fetch_snow_data.py data/runs.geojson --from-year 2024 --to-year 2024 --max-tiles 1
```

## Data Attribution

This software uses VIIRS snow cover data from NASA. When using this data, please include the following attribution:

Riggs, G. A. and D. K. Hall. 2021. VIIRS/NPP CGF Snow Cover Daily L3 Global 375m SIN Grid, Version 2. [Indicate subset used]. Boulder, Colorado USA. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/PN50Y51IVNLE. [Date Accessed].

## Contributing

This project is part of the [OpenSkiMap.org](https://openskimap.org) ecosystem. Contributions are welcome! Please feel free to submit issues and enhancement requests.