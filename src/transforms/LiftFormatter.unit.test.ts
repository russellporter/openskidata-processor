import { LiftType } from "openskidata-format";
import { InputLiftFeature, InputLiftProperties } from "../features/LiftFeature";
import { formatLift } from "./LiftFormatter";

describe("LiftFormatter", () => {
  it("formats funicular", () => {
    const feature = formatLift(
      inputLift({
        id: "way/1",
        railway: "funicular",
        name: "🇫🇷 Nom de la téléski",
        "name:en": "Lift name"
      })
    );
    expect(feature!.properties.liftType).toBe(LiftType.Funicular);
  });

  it("formats rack railway", () => {
    const feature = formatLift(
      inputLift({
        id: "way/1",
        rack: "riggenbach",
        railway: "narrow_gauge",
        "railway:traffic_mode": "passenger"
      })
    );
    expect(feature!.properties.liftType).toBe(LiftType.RackRailway);
  });

  it("includes localized names", () => {
    const feature = formatLift(
      inputLift({
        id: "way/1",
        aerialway: "chair_lift",
        name: "🇫🇷 Nom de la téléski",
        "name:en": "Lift name"
      })
    );
    expect(feature!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la téléski, Lift name"`
    );
  });

  it("drops unsupported lift types", () => {
    expect(
      formatLift(
        inputLift({
          id: "way/1",
          aerialway: "zip_line"
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          id: "way/1",
          aerialway: "goods"
        })
      )
    ).toBeNull();
  });

  it("drops inaccessible lift types", () => {
    expect(
      formatLift(
        inputLift({
          id: "way/1",
          aerialway: "chair_lift",
          access: "private"
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          id: "way/1",
          aerialway: "chair_lift",
          foot: "no"
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          id: "way/1",
          rack: "riggenbach",
          railway: "narrow_gauge",
          "railway:traffic_mode": "freight"
        })
      )
    ).toBeNull();
  });
});

function inputLift(properties: InputLiftProperties): InputLiftFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: properties
  };
}
