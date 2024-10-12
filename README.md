# OpenSkiData Processor

This is a data pipeline that consumes OpenStreetMap & Skimap.org data and produces GeoJSON & Mapbox GL tiles for usage on [OpenSkiMap.org](https://github.com/russellporter/openskimap.org).

## Installation

1. Install Docker
2. `npm install`

## Usage

`./run.sh`

To download data for only a specific area, specify a GeoJSON format bounding box in an environment variable: `BBOX="[-13, -90, 65, 90]"`

The output is placed in several `geojson` and `mbtiles` files within the `data` folder. The output location can be overridden by setting `OUTPUT_DIR`.

### Advanced

For quick development iterations, `./run.sh --skip-download` uses the previously downloaded data.

## Optional Features

### Elevation data

Features will be augmented with elevation data.

To enable, set `ELEVATION_SERVER_URL` to an endpoint that can receive POST requests in the format of https://github.com/racemap/elevation-service.
You should use a local instance of the elevation server because a large number of requests will be performed.

### Reverse geocoding

Features will be augmented with country/region/locality information.

To enable, set `GEOCODING_SERVER_URL` to an endpoint that reverse geocodes in the format of https://photon.komoot.io/reverse. Geocoding results are cached on disk (by default in the `cache` directory) for faster subsequent runs of the processor.

## Contact

Feature requests and bug reports are tracked in the [main project repo](https://github.com/russellporter/openskimap.org/issues/). 
