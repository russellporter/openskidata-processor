import { FeatureType, LiftType, SkiAreaActivity, SpotType, Status } from "openskidata-format";
import { mockViewportHint } from "../testUtils";
import { LiftStationAssociator } from "./LiftStationAssociator";
import { ClusteringDatabase, Cursor, SearchContext } from "./database/ClusteringDatabase";
import { LiftObject, MapObject, SpotObject } from "./MapObject";

function makeCursor<T>(items: T[]): Cursor<T> {
  let done = false;
  return {
    async nextBatch() {
      if (done) return null;
      done = true;
      return items;
    },
    async all() {
      return items;
    },
  };
}

function makeLift(activities: SkiAreaActivity[]): LiftObject {
  return {
    _key: "lift-1",
    _id: "lift-1",
    type: FeatureType.Lift,
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0, 1000],
        [0.001, 0.001, 1200],
      ],
    },
    activities,
    skiAreas: [],
    liftType: LiftType.ChairLift,
    isInSkiAreaPolygon: false,
    isInSkiAreaSite: false,
    stationIds: [],
    properties: {
      type: FeatureType.Lift,
      id: "lift-1",
      liftType: LiftType.ChairLift,
      status: Status.Proposed,
      access: null,
      name: null,
      ref: null,
      refFRCAIRN: null,
      description: null,
      oneway: null,
      occupancy: null,
      capacity: null,
      duration: null,
      detachable: null,
      bubble: null,
      heating: null,
      tunnel: null,
      stations: [],
      skiAreas: [],
      sources: [],
      websites: [],
      wikidataID: null,
      places: [],
      viewportHint: mockViewportHint(),
    },
  };
}

function makeStation(): SpotObject {
  return {
    _key: "station-1",
    _id: "station-1",
    type: FeatureType.Spot,
    geometry: {
      type: "Point",
      coordinates: [0, 0, 1000],
    },
    activities: [SkiAreaActivity.Downhill],
    skiAreas: [],
    isInSkiAreaPolygon: false,
    isInSkiAreaSite: false,
    properties: {
      type: FeatureType.Spot,
      id: "station-1",
      spotType: SpotType.LiftStation,
      name: null,
      position: null,
      entry: null,
      exit: null,
      liftId: "",
      skiAreas: [],
      sources: [],
      places: [],
      viewportHint: mockViewportHint(),
    },
  };
}

function makeDatabase(lifts: LiftObject[], station: SpotObject): {
  database: ClusteringDatabase;
  capturedContexts: SearchContext[];
  updatedObjects: Array<{ key: string; updates: any }>;
} {
  const capturedContexts: SearchContext[] = [];
  const updatedObjects: Array<{ key: string; updates: any }> = [];

  const database: ClusteringDatabase = {
    getAllLiftStations: async () => makeCursor([station]),
    findNearbyObjects: async (_geom, context) => {
      capturedContexts.push(context);
      return lifts;
    },
    updateObject: async (key, updates) => {
      updatedObjects.push({ key, updates });
    },
    updateObjects: async () => {},
    removeObject: async () => {},
    getObjectById: async (id) => lifts.find((l) => l._key === id) ?? null,
    initialize: async () => {},
    close: async () => {},
    saveObject: async () => {},
    saveObjects: async () => {},
    createIndexes: async () => {},
    getSkiAreas: async () => makeCursor([]),
    getSkiAreasByIds: async () => makeCursor([]),
    getAllRuns: async () => makeCursor([]),
    getAllLifts: async () => makeCursor([]),
    getAllSpots: async () => makeCursor([]),
    getObjectsForSkiArea: async () => [],
    markObjectsAsPartOfSkiArea: async () => {},
    getNextUnassignedRun: async () => null,
    streamObjects: async function* () {},
    getObjectDerivedSkiAreaGeometry: async () => ({ type: "Point", coordinates: [0, 0] }),
  };

  return { database, capturedContexts, updatedObjects };
}

describe("LiftStationAssociator", () => {
  describe("associateStationsWithLifts", () => {
    it("queries for nearby lifts without activity filtering", async () => {
      const proposedLift = makeLift([]); // proposed lifts have no activities
      const station = makeStation();
      const { database, capturedContexts } = makeDatabase([proposedLift], station);

      const associator = new LiftStationAssociator(database);
      await associator.associateStationsWithLifts();

      expect(capturedContexts).toHaveLength(1);
      expect(capturedContexts[0].activities).toEqual([]);
    });

    it("snaps station to a proposed lift", async () => {
      const proposedLift = makeLift([]); // proposed lifts have no activities
      const station = makeStation();
      const { database, updatedObjects } = makeDatabase([proposedLift], station);

      const associator = new LiftStationAssociator(database);
      await associator.associateStationsWithLifts();

      expect(updatedObjects).toHaveLength(1);
      expect(updatedObjects[0].updates.properties.liftId).toBe("lift-1");
    });

    it("snaps station to an operating lift", async () => {
      const operatingLift = makeLift([SkiAreaActivity.Downhill]);
      const station = makeStation();
      const { database, updatedObjects } = makeDatabase([operatingLift], station);

      const associator = new LiftStationAssociator(database);
      await associator.associateStationsWithLifts();

      expect(updatedObjects).toHaveLength(1);
      expect(updatedObjects[0].updates.properties.liftId).toBe("lift-1");
    });
  });
});
