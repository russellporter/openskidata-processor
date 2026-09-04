import { LiftType } from "openskidata-format";
import { InputLiftFeature, OSMLiftTags } from "../features/LiftFeature.js";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties.js";
import { formatLift } from "./LiftFormatter.js";

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
      }),
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
      }),
    );
    expect(feature!.properties.liftType).toBe(LiftType.Railway);
  });

  it("formats normal railway", () => {
    const feature = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          railway: "rail",
        },
      }),
    );
    expect(feature!.properties.liftType).toBe(LiftType.Railway);
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
      }),
    );
    expect(feature!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la téléski, Lift name"`,
    );
  });

  it("de-duplicates names", () => {
    const feature = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          aerialway: "chair_lift",
          name: "Lift name",
          "name:en": "Lift name",
        },
      }),
    );
    expect(feature!.properties.name).toMatchInlineSnapshot(`"Lift name"`);
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
        }),
      ),
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "goods",
          },
        }),
      ),
    ).toBeNull();
  });

  it("drops inaccessible lift types", () => {
    const privateLift = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          aerialway: "chair_lift",
          access: "private",
        },
      }),
    );
    expect(privateLift).not.toBeNull();
    expect(privateLift?.properties.access).toBe("private");

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "chair_lift",
            foot: "no",
          },
        }),
      ),
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            rack: "riggenbach",
            railway: "switch",
          },
        }),
      ),
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
        }),
      ),
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
        }),
      ),
    ).toBeNull();
  });

  it("drops lift with unsupported status", () => {
    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "gondola",
            demolished: "yes",
          },
        }),
      ),
    ).toBeNull();

    expect(
      formatLift(
        inputLift({
          type: "way",
          id: 1,
          tags: {
            aerialway: "demolished",
            demolished: "gondola",
          },
        }),
      ),
    ).toBeNull();
  });

  it("sets access property to null when no access tag", () => {
    const lift = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          aerialway: "chair_lift",
        },
      }),
    );
    expect(lift).not.toBeNull();
    expect(lift?.properties.access).toBeNull();
  });

  it("initializes stations property as empty array", () => {
    const lift = formatLift(
      inputLift({
        type: "way",
        id: 1,
        tags: {
          aerialway: "gondola",
        },
      }),
    );
    expect(lift).not.toBeNull();
    expect(lift?.properties.stations).toEqual([]);
  });
});

function inputLift(
  properties: OSMGeoJSONProperties<OSMLiftTags>,
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
