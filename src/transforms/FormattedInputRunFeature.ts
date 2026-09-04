import { RunProperties } from "openskidata-format";
import { InputRunGeometry } from "../features/RunFeature.js";

export type FormattedInputRunFeature = GeoJSON.Feature<
  InputRunGeometry,
  FormattedInputRunProperties
>;

export type FormattedInputRunProperties = Omit<
  RunProperties,
  "elevationProfile"
>;
