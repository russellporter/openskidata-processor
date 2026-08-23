// Reduces a production ski_areas.geojson on stdin to the JoinableSkiArea shape used by
// SkiPassJoiner.int.test.ts. Keep in step with SkiPassEnrichment.toJoinableSkiArea.
//
//   curl -sSL https://tiles.openskimap.org/geojson/ski_areas.geojson | \
//     node src/skiPasses/__fixtures__/generateSkiAreas.js > src/skiPasses/__fixtures__/skiAreas.json

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const skiAreas = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    .features.filter(
      ({ properties }) =>
        properties.name &&
        properties.activities.includes("downhill") &&
        (properties.status === null || properties.status === "operating"),
    )
    .map(({ properties }) => ({
      id: properties.id,
      name: properties.name,
      countries: properties.places.map((place) => place.iso3166_1Alpha2),
      subdivisions: properties.places
        .map((place) => place.iso3166_2)
        .filter((code) => code !== null),
      minElevationInMeters: properties.statistics?.minElevation ?? null,
      maxElevationInMeters: properties.statistics?.maxElevation ?? null,
      sources: properties.sources.map((source) => `${source.type}:${source.id}`),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  process.stdout.write(JSON.stringify(skiAreas, null, 2) + "\n");
});
