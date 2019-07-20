#!/bin/bash
set -e

MY_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $MY_DIR

rm -Rf data/*

docker-compose up -d

ARANGODB_URL="http://$(docker-compose port arangodb 8529)"

npm run download-and-prepare $ARANGODB_URL

docker-compose run tippecanoe \
  tippecanoe -o /data/planet_lifts.mbtiles \
		-f -z 15 -Z 5 --simplify-only-low-zooms \
		--drop-densest-as-needed \
		--named-layer=lifts:/data/mapboxgl_lifts.geojson;

docker-compose run tippecanoe \
  tippecanoe -o /data/planet_runs.mbtiles \
		-f -z 15 -Z 9 --simplify-only-low-zooms \
		--drop-densest-as-needed \
	  --named-layer=runs:/data/mapboxgl_runs.geojson;

docker-compose run tippecanoe \
  tippecanoe -o /data/ski_areas.mbtiles \
		-f -z 15 -Z 0 -B 0 \
		--named-layer=skiareas:/data/mapboxgl_ski_areas.geojson;

docker-compose run tippecanoe \
  tile-join -f --no-tile-size-limit -o /data/openskimap.mbtiles /data/ski_areas.mbtiles /data/planet_runs.mbtiles /data/planet_lifts.mbtiles;

rm -Rf data/openskimap/*
docker-compose run tippecanoe \
  tile-join -e /data/openskimap/ /data/openskimap.mbtiles;

docker-compose down

