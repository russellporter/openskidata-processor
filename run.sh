#!/bin/bash
set -e

MY_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $MY_DIR

RUN_MODE=$1
DOWNLOAD=true

# Parse command line options
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --skip-download)
            DOWNLOAD=false
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

echo "Preparing OpenSkiData..."
npm run prepare-geojson
