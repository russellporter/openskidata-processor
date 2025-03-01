import {
  FeatureType,
  LiftFeature,
  LiftType,
  RunDifficulty,
  RunDifficultyConvention,
  RunFeature,
  RunUse,
  SkiAreaActivity,
  SkiAreaFeature,
  SourceType,
  Status,
} from "openskidata-format";
import { Transform } from "stream";
import {
  createCSVWriteStream,
  formatter,
  getCSVFilename,
} from "./CSVFormatter";

describe("CSVFormatter", () => {
  describe("formatter", () => {
    describe("ski area formatter", () => {
      it("formats a ski area to CSV", () => {
        const skiAreaFeature: SkiAreaFeature = {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [10.0, 20.0],
          },
          properties: {
            type: FeatureType.SkiArea,
            id: "test-ski-area",
            name: "Test Ski Area",
            activities: [SkiAreaActivity.Downhill, SkiAreaActivity.Nordic],
            status: Status.Operating,
            sources: [
              { type: SourceType.OPENSTREETMAP, id: "123" },
              { type: SourceType.SKIMAP_ORG, id: "456" },
            ],
            runConvention: RunDifficultyConvention.EUROPE,
            websites: ["https://testskiarea.com"],
            wikidata_id: null,
            location: {
              iso3166_1Alpha2: "US",
              iso3166_2: "US-CO",
              localized: {
                en: {
                  country: "United States",
                  region: "Colorado",
                  locality: "Vail",
                },
              },
            },
            statistics: {
              runs: {
                byActivity: {
                  downhill: {
                    byDifficulty: {
                      [RunDifficulty.NOVICE]: {
                        count: 2,
                        lengthInKm: 5,
                      },
                      [RunDifficulty.INTERMEDIATE]: {
                        count: 5,
                        lengthInKm: 10,
                      },
                    },
                  },
                  nordic: {
                    byDifficulty: {
                      [RunDifficulty.NOVICE]: {
                        count: 1,
                        lengthInKm: 8,
                      },
                    },
                  },
                },
              },
              lifts: {
                byType: {
                  [LiftType.ChairLift]: {
                    count: 3,
                    lengthInKm: 3.5,
                  },
                  [LiftType.Gondola]: {
                    count: 1,
                    lengthInKm: 2.0,
                  },
                },
              },
              minElevation: 1200,
              maxElevation: 2400,
            },
          },
        };

        const csv = formatter(FeatureType.SkiArea)(skiAreaFeature);

        expect(csv).toMatchInlineSnapshot(
          `"test-ski-area,Test Ski Area,United States,Colorado,Vail,operating,yes,yes,15,8,1200,1200,2400,4,,europe,,https://testskiarea.com,https://www.openstreetmap.org/123 https://www.skimap.org/SkiAreas/view/456"`,
        );
      });
    });

    describe("run formatter", () => {
      it("formats a run to CSV", () => {
        const runFeature: RunFeature = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [11.177452968770694, 47.312650638218656, 2000],
              [11.175409464719593, 47.31138883724759, 1800],
            ],
          },
          properties: {
            type: FeatureType.Run,
            id: "test-run",
            name: "Test Run",
            ref: "5",
            status: Status.Operating,
            uses: [RunUse.Downhill],
            difficulty: RunDifficulty.INTERMEDIATE,
            difficultyConvention: RunDifficultyConvention.EUROPE,
            oneway: true,
            lit: true,
            gladed: false,
            patrolled: true,
            grooming: null,
            description: null,
            skiAreas: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [10.0, 20.0],
                },
                properties: {
                  type: FeatureType.SkiArea,
                  id: "test-ski-area",
                  name: "Test Ski Area",
                  activities: [SkiAreaActivity.Downhill],
                  status: Status.Operating,
                  location: null,
                },
              },
            ],
            elevationProfile: {
              heights: [2000, 1800],
              resolution: 1000,
            },
            sources: [{ type: SourceType.OPENSTREETMAP, id: "123" }],
            websites: [],
            wikidata_id: null,
          },
        };

        const csv = formatter(FeatureType.Run)(runFeature);

        expect(csv).toMatchInlineSnapshot(`"test-run,Test Run,5,,,,Test Ski Area,test-ski-area,intermediate,red,yes,yes,no,yes,,downhill,289,200,0,0.96,-0.96,1800,2000,europe,,,https://www.openstreetmap.org/123,"`);
      });
    });

    describe("lift formatter", () => {
      it("formats a lift to CSV", () => {
        const liftFeature: LiftFeature = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [10.0, 20.0, 1600],
              [10.1, 20.1, 1800],
              [10.2, 20.2, 2000],
            ],
          },
          properties: {
            type: FeatureType.Lift,
            id: "test-lift",
            name: "Test Lift",
            ref: "A",
            liftType: LiftType.ChairLift,
            status: Status.Operating,
            capacity: 2400,
            occupancy: 4,
            bubble: true,
            heating: true,
            duration: 600,
            oneway: null,
            detachable: true,
            description: null,
            skiAreas: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [10.0, 20.0],
                },
                properties: {
                  type: FeatureType.SkiArea,
                  id: "test-ski-area",
                  name: "Test Ski Area",
                  activities: [SkiAreaActivity.Downhill],
                  status: Status.Operating,
                  location: null,
                },
              },
            ],
            sources: [{ type: SourceType.OPENSTREETMAP, id: "123" }],
            websites: [],
            wikidata_id: null,
          },
        };

        const csv = formatter(FeatureType.Lift)(liftFeature);

        expect(csv).toMatchInlineSnapshot(
          `"test-lift,Test Lift,A,,,,Test Ski Area,test-ski-area,chair_lift,operating,no,600,2400,4,yes,yes,yes,30511,400,50.9,1600,2000,0.01,,,https://www.openstreetmap.org/123,"`,
        );
      });
    });
  });

  describe("createCSVWriteStream", () => {
    it("creates a transform stream that adds headers", (done) => {
      const stream = createCSVWriteStream(FeatureType.SkiArea);
      let output = "";

      const mockWriteStream = new Transform({
        objectMode: true,
        transform(chunk, encoding, callback) {
          output += chunk;
          callback();
        },
      });

      stream.pipe(mockWriteStream);
      stream.write("test-data-1");
      stream.write("test-data-2");
      stream.end(() => {
        expect(output).toMatchInlineSnapshot(`
"id,name,country,region,locality,status,has_downhill,has_nordic,downhill_distance_km,nordic_distance_km,vertical_m,min_elevation_m,max_elevation_m,lift_count,surface_lifts_count,run_convention,wikidata_id,websites,sources
test-data-1
test-data-2
"
`);
        done();
      });
    });
  });

  describe("getCSVFilename", () => {
    it("returns the correct filename for each feature type", () => {
      expect(getCSVFilename(FeatureType.SkiArea)).toBe("ski_areas.csv");
      expect(getCSVFilename(FeatureType.Run)).toBe("runs.csv");
      expect(getCSVFilename(FeatureType.Lift)).toBe("lifts.csv");
    });

    it("throws for unknown feature type", () => {
      expect(() => getCSVFilename("unknown" as FeatureType)).toThrow();
    });
  });
});
