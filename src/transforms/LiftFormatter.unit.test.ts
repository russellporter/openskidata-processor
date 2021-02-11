import { LiftType } from "openskidata-format";
import { InputLiftFeature, OSMLiftTags } from "../features/LiftFeature";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties";
import { formatLift } from "./LiftFormatter";

describe("LiftFormatter", () => {
  it("formats funicular", () => {
    const feature = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          railway: "funicular",
          name: "🇫🇷 Nom de la téléski",
          "name:en": "Lift name",
        },
      })
    );
    expect(feature!.properties.liftType).toBe(LiftType.Funicular);
  });

  it("formats rack railway", () => {
    const feature = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          rack: "riggenbach",
          railway: "narrow_gauge",
          "railway:traffic_mode": "passenger",
        },
      })
    );
    expect(feature!.properties.liftType).toBe(LiftType.RackRailway);
  });

  it("includes localized names", () => {
    const feature = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          aerialway: "chair_lift",
          name: "🇫🇷 Nom de la téléski",
          "name:en": "Lift name",
        },
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
          type: "way",
          id: 1,
          tags: {
            aerialway: "zip_line",
          },
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "goods",
          },
        })
      )
    ).toBeNull();
  });

  it("drops inaccessible lift types", () => {
    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "chair_lift",
            access: "private",
          },
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "chair_lift",
            foot: "no",
          },
        })
      )
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            rack: "riggenbach",
            railway: "narrow_gauge",
            "railway:traffic_mode": "freight",
          },
        })
      )
    ).toBeNull();
  });

  it("drops invalid tagging mixing lifecycle & proposed value tagging", () => {
    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "proposed",
            "proposed:aerialway": "gondola",
          },
        })
      )
    ).toBeNull();
  });
});

function inputLift(
  properties: OSMGeoJSONProperties<OSMLiftTags>
): InputLiftFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: properties,
  };
}
