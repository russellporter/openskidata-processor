import clusterSkiAreas from "../clustering/ClusterSkiAreas";

clusterSkiAreas(
  "data/intermediate_ski_areas.geojson",
  "data/ski_areas.geojson",
  "data/intermediate_lifts.geojson",
  "data/lifts.geojson",
  "data/intermediate_runs.geojson",
  "data/runs.geojson"
);
