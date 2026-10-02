import * as URL from "./DownloadURLs.js";

describe("DownloadURLs", () => {
  it("provides expected URLs", () => {
    expect(URL.skiMapSkiAreasURL).toMatchInlineSnapshot(
      `"https://skimap.org/SkiAreas/index.geojson"`,
    );
  });

  const lifecycleSiteTags = [
    "disused:site",
    "abandoned:site",
    "proposed:site",
    "planned:site",
    "construction:site",
  ];

  it.each([
    ["lift download", URL.liftsDownloadConfig],
    ["ski area site download", URL.skiAreaSitesDownloadConfig],
  ])("queries all site=piste lifecycle states in the %s query", (_, config) => {
    const query = config.query(null);

    expect(query).toContain("rel[site=piste]");
    for (const tag of lifecycleSiteTags) {
      expect(query).toContain(`rel[\"${tag}\"=piste]`);
    }

    if (config === URL.liftsDownloadConfig) {
      expect(query).toContain(">>;");
    }
  });
});
