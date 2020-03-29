import * as URL from "./DownloadURLs";

describe("DownloadURLs", () => {
  it("provides expected URLs", () => {
    expect(URL.skiAreasURL).toMatchInlineSnapshot(
      `"http://overpass-api.de/api/interpreter?data=%0A%5Bout%3Ajson%5D%5Btimeout%3A1800%5D%3B(%0A%20%20node%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Flanduse%24%22~%22%5Ewinter_sports%24%22%5D%3B%0A%20%20way%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Flanduse%24%22~%22%5Ewinter_sports%24%22%5D%3B%0A%20%20rel%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Flanduse%24%22~%22%5Ewinter_sports%24%22%5D%3B%0A)%3B%0A(._%3B%20%3E%3B)%3B%0Aout%3B%0A"`
    );
    expect(URL.runsURL).toMatchInlineSnapshot(
      `"http://overpass-api.de/api/interpreter?data=%0A%5Bout%3Ajson%5D%5Btimeout%3A1800%5D%3B(%0A%20%20way%5B%22piste%3Atype%22%5D%3B%0A%20%20rel%5B%22piste%3Atype%22%5D%3B%0A)%3B%0A(._%3B%20%3E%3B)%3B%0Aout%3B%0A"`
    );
    expect(URL.liftsURL).toMatchInlineSnapshot(
      `"http://overpass-api.de/api/interpreter?data=%0A%5Bout%3Ajson%5D%5Btimeout%3A1800%5D%3B(%0A%20%20way%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Faerialway%24%22~%22%5E.*%24%22%5D%3B%0A%20%20rel%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Faerialway%24%22~%22%5E.*%24%22%5D%3B%0A%20%20way%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Frailway%24%22~%22%5Efunicular%24%22%5D%3B%0A%20%20rel%5B~%22%5E(%5BA-Za-z%5D%2B%3A)%3Frailway%24%22~%22%5Efunicular%24%22%5D%3B%0A)%3B%0A(._%3B%20%3E%3B)%3B%0Aout%3B%0A"`
    );
    expect(URL.skiMapSkiAreasURL).toMatchInlineSnapshot(
      `"https://skimap.org/SkiAreas/index.geojson"`
    );
  });
});
