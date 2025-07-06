# OpenSkiData Processor

This is a data pipeline that consumes OpenStreetMap & Skimap.org data and produces GeoJSON & Mapbox GL tiles for usage on [OpenSkiMap.org](https://github.com/russellporter/openskimap.org).

## Installation & Usage

### Docker (Recommended)

**Production:**

```bash
# Build the processor
docker build -t openskidata-processor .

# Run the processor (container stays running for external commands)
docker run -d --name openskidata-processor -v $(pwd)/data:/app/data openskidata-processor

# Execute the processing pipeline
docker exec openskidata-processor ./run.sh

# Or run specific commands
docker exec openskidata-processor npm run download
docker exec openskidata-processor npm run prepare-geojson
```

**Development:**

```bash
# Start development environment
docker compose up -d

# Run commands
docker compose exec app npm test
docker compose exec app npm run check-types
docker compose exec app ./run.sh

# Or get a shell
docker compose exec app bash
```

**Note:** The Docker container runs in daemon mode and stays running to allow external command execution. Use `docker exec` or `docker compose exec` to run processing commands inside the container.

To download data for only a specific area, specify a GeoJSON format bounding box in an environment variable: `BBOX="[-13, -90, 65, 90]"`

The output is placed in files within the `data` folder. The output location can be overridden by setting `OUTPUT_DIR`.

The GeoPackage file (`openskidata.gpkg`) contains all three layers (ski areas, runs, and lifts) in a single file, making it easy to use with GIS software like QGIS.

The processor is RAM hungry. `MAX_OLD_SPACE_SIZE` can be set to adjust the memory usage of the node process, it defaults to 4GB which is sufficient for most cases.

### Advanced

For quick development iterations, `./run.sh --skip-download` uses the previously downloaded data.

## Optional Features

### Caching

To speed up subsequent runs of the processor, some data (elevations, geocodes, snow cover) is cached. The default directory for caches is `data`. This can be overridden with the `CACHE_DIR` environment variable.

### Elevation data

Features will be augmented with elevation data. Enabled out of the box when the docker compose file is used.

To enable, set `ELEVATION_SERVER_URL` to an endpoint that can receive POST requests in the format of https://github.com/racemap/elevation-service.
You should use a local instance of the elevation server because a large number of requests will be performed.

### Reverse geocoding

Features will be augmented with country/region/locality information.

To enable, set `GEOCODING_SERVER_URL` to an endpoint that reverse geocodes in the format of https://photon.komoot.io/reverse. Geocoding results are cached on disk (by default in the `cache` directory) for faster subsequent runs of the processor.

### Snow cover data

Ski areas and runs can be augmented with VIIRS satellite snow cover data.

**Setup:**

1. Follow installation instructions in the `snow-cover/` directory
2. Set up NASA Earthdata authentication (see snow-cover README)
3. Enable with `ENABLE_SNOW_COVER=1` when running the processor

Note: Snow cover data is included in the output when enabled.

**Fetch policies** (`SNOW_COVER_FETCH_POLICY`):

- `full` (default) - fetch all required snow cover data that is not already cached
- `incremental` - only extend already cached data with new temporal data
- `none` - do not fetch any new snow cover data, only use cached data

Incremental fetching is useful for long term deployments where you want to keep the existing data up to date without fetching data for new locations. The data is cached at pixel resolution (375m), so a new run can trigger a large data fetch of historical data when using the 'full' policy just to fill one pixel worth of data. Therefore its recommended to only use `full` occasionally (annually) to fill gaps created by runs in new locations.

Note: uses of this data must cite the [source](https://nsidc.org/data/vnp10a1/versions/2) as follows:

Riggs, G. A. & Hall, D. K. (2023). VIIRS/NPP Snow Cover Daily L3 Global 375m SIN Grid. (VNP10A1, Version 2). Boulder, Colorado USA. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/45VDCKJBXWEE.

### Mapbox Vector Tiles

Pass `GENERATE_TILES=1` to enable generation of Mapbox Vector Tiles (MVT) output. This will output an `.mbtiles` file in the output directory.

## Issue reporting

Feature requests and bug reports are tracked in the [main project repo](https://github.com/russellporter/openskimap.org/issues/).
