#!/bin/bash
set -e

docker compose run --rm tippecanoe \
  tippecanoe -Q -o /data/planet_lifts.mbtiles \
		-f -z 15 -Z 5 --simplify-only-low-zooms \
		--drop-densest-as-needed \
		--named-layer=lifts:/data/mapboxgl_lifts.geojson;

docker compose run --rm tippecanoe \
  tippecanoe -Q -o /data/planet_runs.mbtiles \
		-f -z 15 -Z 9 --simplify-only-low-zooms \
		--drop-densest-as-needed \
	  --named-layer=runs:/data/mapboxgl_runs.geojson;

docker compose run --rm tippecanoe \
  tippecanoe -Q -o /data/ski_areas.mbtiles \
		-f -z 15 -Z 0 -B 0 \
		--named-layer=skiareas:/data/mapboxgl_ski_areas.geojson;

docker compose run --rm tippecanoe \
  tile-join -f --no-tile-size-limit -o /data/openskimap.mbtiles /data/ski_areas.mbtiles /data/planet_runs.mbtiles /data/planet_lifts.mbtiles;

rm -Rf data/openskimap/*
docker compose run --rm tippecanoe \
  tile-join -e /data/openskimap/ /data/openskimap.mbtiles;
