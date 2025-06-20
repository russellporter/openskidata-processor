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

echo "Converting to GeoJSON..."
npm run prepare-geojson

if [ "$GENERATE_MBTILES" = true ]; then
    echo "Convert to MBTiles..."
    ./generate_mbtiles.sh
fi
