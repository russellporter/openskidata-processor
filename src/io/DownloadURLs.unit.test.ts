import * as URL from "./DownloadURLs";

describe("DownloadURLs", () => {
  it("provides expected URLs", () => {
    expect(URL.skiMapSkiAreasURL).toMatchInlineSnapshot(
      `"https://skimap.org/SkiAreas/index.geojson"`,
    );
  });
});
