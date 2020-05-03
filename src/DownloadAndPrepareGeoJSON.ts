import { Config } from "./Config";
import downloadAndConvertToGeoJSON from "./io/GeoJSONDownloader";
import {
  GeoJSONIntermediatePaths,
  GeoJSONOutputPaths,
} from "./io/GeoJSONFiles";
import prepare from "./PrepareGeoJSON";

export default async function downloadAndPrepare(
  outputFolder: string,
  config: Config
) {
  const input = await downloadAndConvertToGeoJSON(outputFolder, config.bbox);
  await prepare(
    {
      input: input,
      intermediate: new GeoJSONIntermediatePaths(outputFolder),
      output: new GeoJSONOutputPaths(outputFolder),
    },
    config
  );
}
