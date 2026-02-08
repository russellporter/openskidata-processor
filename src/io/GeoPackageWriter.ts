import {
  BoundingBox,
  GeoPackage,
  GeoPackageAPI,
  GeometryColumns,
} from "@ngageoint/geopackage";
import centroid from "@turf/centroid";
import { existsSync } from "fs";
import { Feature } from "geojson";
import {
  FeatureType,
  LiftProperties,
  RunProperties,
  SkiAreaProperties,
  SpotProperties,
} from "openskidata-format";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import { readGeoJSONFeatures } from "./GeoJSONReader";

// Type-safe column definition
interface ColumnDefinition<T> {
  name: string;
  dataType: "TEXT" | "REAL" | "BOOLEAN";
  getValue: (properties: T) => string | number | boolean | null | undefined;
}

// Type helper to ensure type safety
type FeaturePropertiesMap = {
  [FeatureType.SkiArea]: SkiAreaProperties;
  [FeatureType.Lift]: LiftProperties;
  [FeatureType.Run]: RunProperties;
  [FeatureType.Spot]: SpotProperties;
};

// Helper functions to convert values for SQLite
const toSQLiteBoolean = (value: boolean | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return value ? 1 : 0;
};

const toJSON = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
};

// Helper to create common columns for a specific type
// Includes place columns with semicolon-separated values from all places in the array:
// country_codes, region_codes, countries, regions, localities
function createCommonColumns<
  T extends SkiAreaProperties | LiftProperties | RunProperties,
>(): ColumnDefinition<T>[] {
  return [
    {
      name: "feature_id",
      dataType: "TEXT",
      getValue: (p) => p.id,
    },
    {
      name: "name",
      dataType: "TEXT",
      getValue: (p) => p.name,
    },
    {
      name: "status",
      dataType: "TEXT",
      getValue: (p) => p.status,
    },
    {
      name: "sources",
      dataType: "TEXT",
      getValue: (p) => toJSON(p.sources),
    },
    {
      name: "websites",
      dataType: "TEXT",
      getValue: (p) => toJSON(p.websites),
    },
    {
      name: "wikidata_id",
      dataType: "TEXT",
      getValue: (p) => p.wikidataID,
    },
    // Place fields (semicolon-separated unique lists from places array)
    {
      name: "country_codes",
      dataType: "TEXT",
      getValue: (p) => {
        const unique = Array.from(
          new Set(p.places.map((place) => place.iso3166_1Alpha2)),
        ).sort();
        return unique.length > 0 ? unique.join(";") : null;
      },
    },
    {
      name: "region_codes",
      dataType: "TEXT",
      getValue: (p) => {
        const unique = Array.from(
          new Set(
            p.places
              .map((place) => place.iso3166_2)
              .filter((r) => r) as string[],
          ),
        ).sort();
        return unique.length > 0 ? unique.join(";") : null;
      },
    },
    {
      name: "countries",
      dataType: "TEXT",
      getValue: (p) => {
        const unique = Array.from(
          new Set(p.places.map((place) => place.localized.en.country)),
        ).sort();
        return unique.length > 0 ? unique.join(";") : null;
      },
    },
    {
      name: "regions",
      dataType: "TEXT",
      getValue: (p) => {
        const unique = Array.from(
          new Set(
            p.places
              .map((place) => place.localized.en.region)
              .filter((r) => r) as string[],
          ),
        ).sort();
        return unique.length > 0 ? unique.join(";") : null;
      },
    },
    {
      name: "localities",
      dataType: "TEXT",
      getValue: (p) => {
        const unique = Array.from(
          new Set(
            p.places
              .map((place) => place.localized.en.locality)
              .filter((l) => l) as string[],
          ),
        ).sort();
        return unique.length > 0 ? unique.join(";") : null;
      },
    },
  ];
}

const SKI_AREA_SCHEMA: ColumnDefinition<SkiAreaProperties>[] = [
  ...createCommonColumns<SkiAreaProperties>(),
  {
    name: "activities",
    dataType: "TEXT",
    getValue: (p) => p.activities.join(","),
  },
  {
    name: "min_elevation",
    dataType: "REAL",
    getValue: (p) => p.statistics?.minElevation,
  },
  {
    name: "max_elevation",
    dataType: "REAL",
    getValue: (p) => p.statistics?.maxElevation,
  },
  {
    name: "statistics",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.statistics),
  },
  {
    name: "run_convention",
    dataType: "TEXT",
    getValue: (p) => p.runConvention,
  },
];

const LIFT_SCHEMA: ColumnDefinition<LiftProperties>[] = [
  ...createCommonColumns<LiftProperties>(),
  {
    name: "lift_type",
    dataType: "TEXT",
    getValue: (p) => p.liftType,
  },
  {
    name: "access",
    dataType: "TEXT",
    getValue: (p) => p.access,
  },
  {
    name: "ref",
    dataType: "TEXT",
    getValue: (p) => p.ref,
  },
  {
    name: "ref_fr_cairn",
    dataType: "TEXT",
    getValue: (p) => p.refFRCAIRN,
  },
  {
    name: "description",
    dataType: "TEXT",
    getValue: (p) => p.description,
  },
  {
    name: "oneway",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.oneway),
  },
  {
    name: "occupancy",
    dataType: "REAL",
    getValue: (p) => p.occupancy,
  },
  {
    name: "capacity",
    dataType: "REAL",
    getValue: (p) => p.capacity,
  },
  {
    name: "duration",
    dataType: "REAL",
    getValue: (p) => p.duration,
  },
  {
    name: "detachable",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.detachable),
  },
  {
    name: "bubble",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.bubble),
  },
  {
    name: "heating",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.heating),
  },
  {
    name: "ski_area_ids",
    dataType: "TEXT",
    getValue: (p) => p.skiAreas.map((area) => area.properties.id).join(","),
  },
  {
    name: "ski_area_names",
    dataType: "TEXT",
    getValue: (p) =>
      p.skiAreas
        .map((area) => area.properties.name)
        .filter((name) => name)
        .join(","),
  },
];

const RUN_SCHEMA: ColumnDefinition<RunProperties>[] = [
  ...createCommonColumns<RunProperties>(),
  {
    name: "uses",
    dataType: "TEXT",
    getValue: (p) => p.uses.join(","),
  },
  {
    name: "ref",
    dataType: "TEXT",
    getValue: (p) => p.ref,
  },
  {
    name: "description",
    dataType: "TEXT",
    getValue: (p) => p.description,
  },
  {
    name: "difficulty",
    dataType: "TEXT",
    getValue: (p) => p.difficulty,
  },
  {
    name: "difficulty_convention",
    dataType: "TEXT",
    getValue: (p) => p.difficultyConvention,
  },
  {
    name: "oneway",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.oneway),
  },
  {
    name: "lit",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.lit),
  },
  {
    name: "gladed",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.gladed),
  },
  {
    name: "patrolled",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.patrolled),
  },
  {
    name: "snowmaking",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.snowmaking),
  },
  {
    name: "snowfarming",
    dataType: "BOOLEAN",
    getValue: (p) => toSQLiteBoolean(p.snowfarming),
  },
  {
    name: "grooming",
    dataType: "TEXT",
    getValue: (p) => p.grooming,
  },
  {
    name: "elevation_profile_heights",
    dataType: "TEXT",
    getValue: (p) => p.elevationProfile?.heights.join(","),
  },
  {
    name: "elevation_profile_resolution",
    dataType: "REAL",
    getValue: (p) => p.elevationProfile?.resolution,
  },
  {
    name: "ski_area_ids",
    dataType: "TEXT",
    getValue: (p) => p.skiAreas.map((area) => area.properties.id).join(","),
  },
  {
    name: "ski_area_names",
    dataType: "TEXT",
    getValue: (p) =>
      p.skiAreas
        .map((area) => area.properties.name)
        .filter((name) => name)
        .join(","),
  },
];

const SPOT_SCHEMA: ColumnDefinition<SpotProperties>[] = [
  {
    name: "feature_id",
    dataType: "TEXT",
    getValue: (p) => p.id,
  },
  {
    name: "spot_type",
    dataType: "TEXT",
    getValue: (p) => p.spotType,
  },
  {
    name: "sources",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.sources),
  },
  {
    name: "ski_area_ids",
    dataType: "TEXT",
    getValue: (p) => p.skiAreas.map((area) => area.properties.id).join(","),
  },
  {
    name: "ski_area_names",
    dataType: "TEXT",
    getValue: (p) =>
      p.skiAreas
        .map((area) => area.properties.name)
        .filter((name) => name)
        .join(","),
  },
  {
    name: "country_codes",
    dataType: "TEXT",
    getValue: (p) => {
      const unique = Array.from(
        new Set(p.places.map((place) => place.iso3166_1Alpha2)),
      ).sort();
      return unique.length > 0 ? unique.join(";") : null;
    },
  },
  {
    name: "region_codes",
    dataType: "TEXT",
    getValue: (p) => {
      const unique = Array.from(
        new Set(
          p.places.map((place) => place.iso3166_2).filter((r) => r) as string[],
        ),
      ).sort();
      return unique.length > 0 ? unique.join(";") : null;
    },
  },
  {
    name: "countries",
    dataType: "TEXT",
    getValue: (p) => {
      const unique = Array.from(
        new Set(p.places.map((place) => place.localized.en.country)),
      ).sort();
      return unique.length > 0 ? unique.join(";") : null;
    },
  },
  {
    name: "regions",
    dataType: "TEXT",
    getValue: (p) => {
      const unique = Array.from(
        new Set(
          p.places
            .map((place) => place.localized.en.region)
            .filter((r) => r) as string[],
        ),
      ).sort();
      return unique.length > 0 ? unique.join(";") : null;
    },
  },
  {
    name: "localities",
    dataType: "TEXT",
    getValue: (p) => {
      const unique = Array.from(
        new Set(
          p.places
            .map((place) => place.localized.en.locality)
            .filter((l) => l) as string[],
        ),
      ).sort();
      return unique.length > 0 ? unique.join(";") : null;
    },
  },
  {
    name: "dismount",
    dataType: "TEXT",
    getValue: (p) => (p.spotType === "crossing" ? p.dismount : null),
  },
  {
    name: "name",
    dataType: "TEXT",
    getValue: (p) => (p.spotType === "lift_station" ? p.name : null),
  },
  {
    name: "position",
    dataType: "TEXT",
    getValue: (p) => (p.spotType === "lift_station" ? p.position : null),
  },
  {
    name: "entry",
    dataType: "BOOLEAN",
    getValue: (p) =>
      p.spotType === "lift_station" ? toSQLiteBoolean(p.entry) : null,
  },
  {
    name: "exit",
    dataType: "BOOLEAN",
    getValue: (p) =>
      p.spotType === "lift_station" ? toSQLiteBoolean(p.exit) : null,
  },
];

const FEATURE_SCHEMAS = {
  [FeatureType.SkiArea]: SKI_AREA_SCHEMA,
  [FeatureType.Lift]: LIFT_SCHEMA,
  [FeatureType.Run]: RUN_SCHEMA,
  [FeatureType.Spot]: SPOT_SCHEMA,
} as const;

export class GeoPackageWriter {
  private geoPackage: GeoPackage | null = null;

  constructor() {}

  async initialize(filePath: string): Promise<void> {
    // Open existing GeoPackage or create new one
    if (existsSync(filePath)) {
      this.geoPackage = await GeoPackageAPI.open(filePath);
    } else {
      this.geoPackage = await GeoPackageAPI.create(filePath);
    }

    // Apply SQLite performance optimizations
    this.optimizeDatabaseForBulkInsert();
  }

  /**
   * Optimizes SQLite database for bulk insert operations
   */
  private optimizeDatabaseForBulkInsert(): void {
    if (!this.geoPackage) {
      throw new Error("GeoPackage not initialized");
    }

    try {
      const db = this.geoPackage.database;

      db.run("PRAGMA journal_mode = WAL");
      db.run("PRAGMA cache_size = -65536"); // 64MB cache
      db.run("PRAGMA synchronous = NORMAL");
      db.run("PRAGMA page_size = 4096");
      db.run("PRAGMA temp_store = MEMORY");
      db.run("PRAGMA mmap_size = 268435456"); // 256MB
    } catch (error) {
      console.warn("Warning: Could not apply database optimizations:", error);
    }
  }

  /**
   * Add features to a layer (appending to existing tables or creating new ones).
   * Groups features by geometry type and creates separate tables for each type.
   *
   * @param skipSpatialIndex - Skip creating spatial indexes (useful when adding multiple batches)
   */
  async addToFeatureLayer<T extends FeatureType>(
    layerName: string,
    features: Feature<GeoJSON.Geometry, FeaturePropertiesMap[T]>[],
    featureType: T,
    skipSpatialIndex: boolean = false,
  ): Promise<void> {
    if (!this.geoPackage) {
      throw new Error("GeoPackage not initialized");
    }

    if (features.length === 0) {
      return;
    }

    // Special handling for ski areas - create point layer with centroids
    if (featureType === FeatureType.SkiArea) {
      const pointFeatures = features.map((feature) => {
        // Use turf centroid to get the center point of any geometry
        const centerPoint = centroid(feature);
        return {
          ...feature,
          geometry: centerPoint.geometry,
        };
      });

      // Output all ski areas to a single point layer
      const pointTableName = `${layerName}_point`;
      await this.addFeaturesToTable(
        pointTableName,
        pointFeatures,
        featureType,
        skipSpatialIndex,
      );

      // Filter out point features for the original geometry processing
      // to avoid duplicating them
      features = features.filter((f) => f.geometry.type !== "Point");
    }

    // Group features by geometry type
    const featuresByGeometryType = new Map<
      string,
      Feature<GeoJSON.Geometry, FeaturePropertiesMap[T]>[]
    >();
    features.forEach((feature) => {
      let geomType = feature.geometry.type;
      // Group Polygon features as MultiPolygon
      if (geomType === "Polygon") {
        geomType = "MultiPolygon";
      }
      if (!featuresByGeometryType.has(geomType)) {
        featuresByGeometryType.set(geomType, []);
      }
      featuresByGeometryType.get(geomType)!.push(feature);
    });

    // Create a separate table for each geometry type
    for (const [geomType, geomFeatures] of Array.from(featuresByGeometryType)) {
      const tableName = `${layerName}_${geomType.toLowerCase()}`;
      await this.addFeaturesToTable(
        tableName,
        geomFeatures,
        featureType,
        skipSpatialIndex,
      );
    }
  }

  /**
   * Create spatial indexes for all tables in a layer
   */
  async createIndexesForLayer(layerName: string): Promise<void> {
    if (!this.geoPackage) {
      throw new Error("GeoPackage not initialized");
    }

    const tables = this.geoPackage.getFeatureTables();
    const layerTables = tables.filter((t) => t.startsWith(layerName + "_"));

    for (const tableName of layerTables) {
      await this.geoPackage.indexFeatureTable(tableName);
    }
  }

  private getSchema<T extends FeatureType>(
    featureType: T,
  ): ColumnDefinition<FeaturePropertiesMap[T]>[] {
    return FEATURE_SCHEMAS[featureType] as ColumnDefinition<
      FeaturePropertiesMap[T]
    >[];
  }

  private getColumnDefinitions(
    featureType: FeatureType,
  ): { name: string; dataType: string }[] {
    const schema = this.getSchema(featureType);
    return schema.map((col) => ({
      name: col.name,
      dataType: col.dataType,
    }));
  }

  private async addFeaturesToTable<T extends FeatureType>(
    tableName: string,
    features: Feature<GeoJSON.Geometry, FeaturePropertiesMap[T]>[],
    featureType: T,
    skipSpatialIndex: boolean = false,
  ): Promise<void> {
    if (!this.geoPackage || features.length === 0) {
      return;
    }

    const columns = this.getColumnDefinitions(featureType);

    // Calculate bounding box
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    features.forEach((feature) => {
      const coords = this.extractCoordinates(feature.geometry);
      coords.forEach((coord) => {
        minX = Math.min(minX, coord[0]);
        maxX = Math.max(maxX, coord[0]);
        minY = Math.min(minY, coord[1]);
        maxY = Math.max(maxY, coord[1]);
      });
    });
    const boundingBox = new BoundingBox(minX, minY, maxX, maxY);

    // Create geometry columns
    const geometryColumns = new GeometryColumns();
    geometryColumns.table_name = tableName;
    geometryColumns.column_name = "geometry";
    geometryColumns.geometry_type_name = this.getGeometryTypeName(features[0]);
    geometryColumns.srs_id = 4326; // WGS84
    geometryColumns.z = 0;
    geometryColumns.m = 0;

    // Create the feature table if it doesn't exist
    if (!this.geoPackage.isTable(tableName)) {
      this.geoPackage.createFeatureTable(
        tableName,
        geometryColumns,
        columns,
        boundingBox,
        4326,
      );
    }

    // Transform properties to SQLite-compatible values
    const transformedFeatures = features.map((feature) => {
      const schema = this.getSchema(featureType);
      const transformedProperties: Record<string, string | number | null> = {};

      schema.forEach((column) => {
        const value = column.getValue(
          feature.properties as FeaturePropertiesMap[T],
        );
        transformedProperties[column.name] =
          value === undefined ? null : (value as string | number | null);
      });

      // Handle Polygon → MultiPolygon conversion
      let geometry = feature.geometry;
      if (geometry.type === "Polygon") {
        geometry = {
          type: "MultiPolygon",
          coordinates: [(geometry as GeoJSON.Polygon).coordinates],
        } as GeoJSON.MultiPolygon;
      }

      return {
        type: "Feature" as const,
        geometry,
        properties: transformedProperties,
      };
    });

    // Use library's batch insert with automatic transaction handling
    await this.geoPackage.addGeoJSONFeaturesToGeoPackage(
      transformedFeatures,
      tableName,
      !skipSpatialIndex, // Create index if not skipped
      1000, // batch size
    );
  }

  private extractCoordinates(geometry: GeoJSON.Geometry): number[][] {
    const coords: number[][] = [];

    const extractFromCoordArray = (arr: unknown): void => {
      if (Array.isArray(arr)) {
        if (
          arr.length >= 2 &&
          typeof arr[0] === "number" &&
          typeof arr[1] === "number"
        ) {
          coords.push(arr as number[]);
        } else {
          arr.forEach((item) => extractFromCoordArray(item));
        }
      }
    };

    if ("coordinates" in geometry) {
      extractFromCoordArray(geometry.coordinates);
    } else if (
      geometry.type === "GeometryCollection" &&
      "geometries" in geometry
    ) {
      geometry.geometries.forEach((g: GeoJSON.Geometry) => {
        const subCoords = this.extractCoordinates(g);
        coords.push(...subCoords);
      });
    }

    return coords;
  }

  private getGeometryTypeName(feature: Feature): string {
    switch (feature.geometry.type) {
      case "Point":
        return "POINT";
      case "LineString":
        return "LINESTRING";
      case "Polygon":
        // Convert Polygon to MultiPolygon
        return "MULTIPOLYGON";
      case "MultiPoint":
        return "MULTIPOINT";
      case "MultiLineString":
        return "MULTILINESTRING";
      case "MultiPolygon":
        return "MULTIPOLYGON";
      case "GeometryCollection":
        return "GEOMETRYCOLLECTION";
      default:
        return "GEOMETRY";
    }
  }

  async close(): Promise<void> {
    if (this.geoPackage) {
      // Optimize database file size
      try {
        this.geoPackage.database.run("VACUUM");
      } catch (error) {
        console.warn("Warning: Could not vacuum database:", error);
      }

      await this.geoPackage.close();
      this.geoPackage = null;
    }
  }
}

export async function convertGeoJSONToGeoPackage<T extends FeatureType>(
  geoJSONPath: string,
  geoPackagePath: string,
  layerName: string,
  featureType: T,
): Promise<void> {
  const writer = new GeoPackageWriter();
  await writer.initialize(geoPackagePath);

  const BATCH_SIZE = 1000;
  let batch: Feature<GeoJSON.Geometry, FeaturePropertiesMap[T]>[] = [];

  await pipeline(
    readGeoJSONFeatures(geoJSONPath),
    new Transform({
      objectMode: true,
      async transform(
        feature: Feature<GeoJSON.Geometry, FeaturePropertiesMap[T]>,
        encoding,
        callback,
      ) {
        batch.push(feature);

        if (batch.length >= BATCH_SIZE) {
          try {
            await writer.addToFeatureLayer(layerName, batch, featureType, true);
            batch = [];
            callback();
          } catch (error) {
            callback(error as Error);
          }
        } else {
          callback();
        }
      },
      async flush(callback) {
        if (batch.length > 0) {
          try {
            await writer.addToFeatureLayer(layerName, batch, featureType, true);
            callback();
          } catch (error) {
            callback(error as Error);
          }
        } else {
          callback();
        }
      },
    }),
  );

  // Create spatial indexes once at the end
  await writer.createIndexesForLayer(layerName);

  await writer.close();
}
