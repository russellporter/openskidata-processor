# OpenSkiData Processor

This is a data pipeline that consumes OpenStreetMap & Skimap.org data and produces GeoJSON & Mapbox GL tiles for usage on OpenSkiMap.org.

## Installation

Install Docker

`npm install`

## Usage

### Produce GeoJSON files

`npm run download-and-prepare`

If you want to use already downloaded input data:
`npm run prepare-geojson`

### Produce Mapbox Tiles & GeoJSON files

`./run.sh`

This uses Docker to provide ski area assignment & statistics as well.

## Optional Features

### Ski area assignment & statistics

Lifts & runs will be assigned to Skimap.org ski areas, or a new ski area will be generated if nothing exists on Skimap.org

Requires ArangoDB instance, the endpoint can be configured by setting `CLUSTERING_ARANGODB_URL`.

### Elevation data

Lifts & runs will be augmented with elevation data.

`ELEVATION_SERVER_URL` must be set to an endpoint that can receive POST requests in the format of https://github.com/racemap/elevation-service
You should use a local instance of the elevation server because a large number of requests will be performed.
