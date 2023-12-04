#!/bin/bash
set -e

MY_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $MY_DIR

RUN_MODE=$1

DOWNLOAD=true
GENERATE_MBTILES=true

# Parse command line options
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --skip-download)
            DOWNLOAD=false
            ;;
        --skip-mbtiles)
            GENERATE_MBTILES=false
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
    shift
done

if [ "$DOWNLOAD" = true ]; then
	echo "Downloading..."
	npm run download
fi

if [ -z "$CLUSTERING_ARANGODB_URL" ]; then
		echo "Starting clustering DB..."
    docker compose up -d
    CLUSTERING_ARANGODB_URL="http://$(docker compose port arangodb 8529)"
fi

echo "Converting to GeoJSON..."
GEOCODING_SERVER_URL="https://photon.komoot.io/reverse" CLUSTERING_ARANGODB_URL=$CLUSTERING_ARANGODB_URL npm run prepare-geojson

if [ -z "$CLUSTERING_ARANGODB_URL" ]; then
	docker compose down
fi

if [ "$GENERATE_MBTILES" = true ]; then
	echo "Convert to MBTiles..."
	./generate_mbtiles.sh
fi