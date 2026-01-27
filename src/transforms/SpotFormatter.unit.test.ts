import {
  CrossingSpotProperties,
  DismountRequirement,
  LiftStationPosition,
  LiftStationSpotProperties,
  SpotType,
} from "openskidata-format";
import OSMGeoJSONProperties from "../features/OSMGeoJSONProperties";
import { InputSpotFeature, OSMSpotTags } from "../features/SpotFeature";
import { formatSpots } from "./SpotFormatter";

describe("SpotFormatter", () => {
  describe("Crossing", () => {
    it("formats crossing with dismount=yes", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            "piste:dismount": "yes",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Crossing);
      expect((features[0].properties as CrossingSpotProperties).dismount).toBe(
        DismountRequirement.Yes,
      );
    });

    it("formats crossing with dismount=no", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            "piste:dismount": "no",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Crossing);
      expect((features[0].properties as CrossingSpotProperties).dismount).toBe(
        DismountRequirement.No,
      );
    });

    it("formats crossing with dismount=sometimes", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            "piste:dismount": "sometimes",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Crossing);
      expect((features[0].properties as CrossingSpotProperties).dismount).toBe(
        DismountRequirement.Sometimes,
      );
    });

    it("rejects crossing with invalid dismount value", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            "piste:dismount": "invalid",
          },
        }),
      );
      expect(features).toEqual([]);
    });
  });

  describe("Lift Station", () => {
    it("formats lift station with all properties", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            name: "Top Station",
            "aerialway:station": "top",
            "aerialway:access": "both",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.name).toBe("Top Station");
      expect(props.position).toBe(LiftStationPosition.Top);
      expect(props.entry).toBe(true);
      expect(props.exit).toBe(true);
    });

    it("formats lift station with only name", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            name: "Middle Station",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.name).toBe("Middle Station");
      expect(props.position).toBeNull();
      expect(props.entry).toBeNull();
      expect(props.exit).toBeNull();
    });

    it("correctly parses aerialway:access=entry", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            "aerialway:access": "entry",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.entry).toBe(true);
      expect(props.exit).toBe(false);
    });

    it("correctly parses aerialway:access=exit", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            "aerialway:access": "exit",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.entry).toBe(false);
      expect(props.exit).toBe(true);
    });

    it("correctly parses aerialway:access=no", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            "aerialway:access": "no",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.entry).toBe(false);
      expect(props.exit).toBe(false);
    });

    it("correctly parses aerialway:station=bottom", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            "aerialway:station": "bottom",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.position).toBe(LiftStationPosition.Bottom);
    });

    it("correctly parses aerialway:station=mid", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            aerialway: "station",
            "aerialway:station": "mid",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.LiftStation);
      const props = features[0].properties as LiftStationSpotProperties;
      expect(props.position).toBe(LiftStationPosition.Mid);
    });
  });

  describe("Avalanche Transceiver", () => {
    it("formats avalanche transceiver training spot", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            amenity: "avalanche_transceiver",
            avalanche_transceiver: "training",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(
        SpotType.AvalancheTransceiverTraining,
      );
    });

    it("formats avalanche transceiver checkpoint spot", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            amenity: "avalanche_transceiver",
            avalanche_transceiver: "checkpoint",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(
        SpotType.AvalancheTransceiverCheckpoint,
      );
    });
  });

  describe("Halfpipe", () => {
    it("formats halfpipe from node", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            man_made: "piste:halfpipe",
          },
        }),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Halfpipe);
    });

    it("formats halfpipe from way", () => {
      const features = formatSpots(
        inputSpotWithGeometry(
          {
            type: "way",
            id: 1,
            tags: {
              man_made: "piste:halfpipe",
            },
          },
          {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        ),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Halfpipe);
      expect(features[0].geometry.type).toBe("Point");
    });

    it("formats halfpipe from area", () => {
      const features = formatSpots(
        inputSpotWithGeometry(
          {
            type: "way",
            id: 1,
            tags: {
              man_made: "piste:halfpipe",
            },
          },
          {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        ),
      );
      expect(features).toHaveLength(1);
      expect(features[0].properties.spotType).toBe(SpotType.Halfpipe);
      expect(features[0].geometry.type).toBe("Point");
    });
  });

  describe("Geometry conversion", () => {
    it("keeps Point geometry unchanged", () => {
      const features = formatSpots(
        inputSpotWithGeometry(
          {
            type: "node",
            id: 1,
            tags: {
              aerialway: "station",
            },
          },
          {
            type: "Point",
            coordinates: [10, 20],
          },
        ),
      );
      expect(features[0].geometry.type).toBe("Point");
      expect(features[0].geometry.coordinates).toEqual([10, 20]);
    });

    it("converts non Point to centroid Point", () => {
      const features = formatSpots(
        inputSpotWithGeometry(
          {
            type: "way",
            id: 1,
            tags: {
              aerialway: "station",
            },
          },
          {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          },
        ),
      );
      expect(features[0].geometry.type).toBe("Point");
    });
  });

  describe("Validation", () => {
    it("rejects features without matching tags", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            highway: "crossing",
          },
        }),
      );
      expect(features).toEqual([]);
    });

    it("returns multiple spots when multiple spot types present", () => {
      const features = formatSpots(
        inputSpot({
          type: "node",
          id: 1,
          tags: {
            "piste:dismount": "yes",
            aerialway: "station",
          },
        }),
      );
      expect(features).toHaveLength(2);
      expect(features[0].properties.spotType).toBe(SpotType.Crossing);
      expect(features[1].properties.spotType).toBe(SpotType.LiftStation);
    });
  });
});

function inputSpot(
  properties: OSMGeoJSONProperties<OSMSpotTags>,
): InputSpotFeature {
  return inputSpotWithGeometry(properties, {
    type: "Point",
    coordinates: [0, 0],
  });
}

function inputSpotWithGeometry(
  properties: OSMGeoJSONProperties<OSMSpotTags>,
  geometry:
    | GeoJSON.Point
    | GeoJSON.Polygon
    | GeoJSON.MultiPolygon
    | GeoJSON.LineString,
): InputSpotFeature {
  return {
    type: "Feature",
    geometry: geometry,
    properties: properties,
  };
}
