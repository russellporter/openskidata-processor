import { ViewportHint } from "openskidata-format";

export function mockViewportHint(): ViewportHint {
  return { center: [0, 0], bearing: null, rotatedWidthMeters: 0, rotatedHeightMeters: 0, minCameraY: 0 };
}
