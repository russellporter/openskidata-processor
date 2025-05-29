import {
  BoundingBox,
  GeoPackage,
  GeoPackageAPI,
  GeometryColumns,
  GeometryData,
} from "@ngageoint/geopackage";
import centroid from "@turf/centroid";
import { existsSync } from "fs";
import { Feature } from "geojson";
import {
  FeatureType,
  LiftProperties,
  RunProperties,
  SkiAreaProperties,
} from "openskidata-format";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import wkx from "wkx";
import { readGeoJSONFeatures } from "./GeoJSONReader";

// Type-safe column definition
interface ColumnDefinition<T> {
  name: string;
  dataType: "TEXT" | "REAL" | "BOOLEAN";
  getValue: (properties: T) => string | number | boolean | null;
}

// Type helper to ensure type safety
type FeaturePropertiesMap = {
  [FeatureType.SkiArea]: SkiAreaProperties;
  [FeatureType.Lift]: LiftProperties;
  [FeatureType.Run]: RunProperties;
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
function createCommonColumns<
  T extends SkiAreaProperties | LiftProperties | RunProperties,
>(): ColumnDefinition<T>[] {
  return [
    {
      name: "feature_id",
      dataType: "TEXT" as const,
      getValue: (p) => p.id,
    },
    {
      name: "name",
      dataType: "TEXT" as const,
      getValue: (p) => p.name,
    },
    {
      name: "status",
      dataType: "TEXT" as const,
      getValue: (p) => p.status,
    },
    {
      name: "sources",
      dataType: "TEXT" as const,
      getValue: (p) => toJSON(p.sources),
    },
    {
      name: "websites",
      dataType: "TEXT" as const,
      getValue: (p) => toJSON(p.websites),
    },
    {
      name: "wikidata_id",
      dataType: "TEXT" as const,
      getValue: (p) => p.wikidata_id,
    },
  ];
}

const SKI_AREA_SCHEMA: ColumnDefinition<SkiAreaProperties>[] = [
  ...createCommonColumns<SkiAreaProperties>(),
  {
    name: "activities",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.activities),
  },
  {
    name: "location",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.location),
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
    getValue: (p) =>
      p.skiAreas
        ? p.skiAreas
            .map((area) => area.properties?.id || "")
            .filter((id) => id)
            .join(",")
        : "",
  },
  {
    name: "ski_area_names",
    dataType: "TEXT",
    getValue: (p) =>
      p.skiAreas
        ? p.skiAreas
            .map((area) => area.properties?.name || "")
            .filter((name) => name)
            .join(",")
        : "",
  },
];

const RUN_SCHEMA: ColumnDefinition<RunProperties>[] = [
  ...createCommonColumns<RunProperties>(),
  {
    name: "uses",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.uses),
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
    name: "grooming",
    dataType: "TEXT",
    getValue: (p) => p.grooming,
  },
  {
    name: "elevation_profile",
    dataType: "TEXT",
    getValue: (p) => toJSON(p.elevationProfile),
  },
  {
    name: "ski_area_ids",
    dataType: "TEXT",
    getValue: (p) => p.skiAreas.map((area) => area.properties.id).join(","),
  },
  {
    name: "ski_area_names",
    dataType: "TEXT",
    getValue: (p) => p.skiAreas.map((area) => area.properties.name).join(","),
  },
];

const FEATURE_SCHEMAS = {
  [FeatureType.SkiArea]: SKI_AREA_SCHEMA,
  [FeatureType.Lift]: LIFT_SCHEMA,
  [FeatureType.Run]: RUN_SCHEMA,
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
  }

  async addFeatureLayer(
    layerName: string,
    features: Feature[],
    featureType: FeatureType,
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
      await this.addFeaturesToTable(pointTableName, pointFeatures, featureType);

      // Filter out point features for the original geometry processing
      // to avoid duplicating them
      features = features.filter((f) => f.geometry.type !== "Point");
    }

    // Group features by geometry type
    const featuresByGeometryType = new Map<string, Feature[]>();
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
    for (const [geomType, geomFeatures] of featuresByGeometryType) {
      const tableName = `${layerName}_${geomType.toLowerCase()}`;
      await this.addFeaturesToTable(tableName, geomFeatures, featureType);
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

  private setFeatureRowValues<T extends FeatureType>(
    featureRow: {
      setValueWithColumnName: (columnName: string, value: unknown) => void;
    },
    properties: FeaturePropertiesMap[T],
    featureType: T,
  ): void {
    const schema = this.getSchema(featureType);

    schema.forEach((column) => {
      const value = column.getValue(properties);
      featureRow.setValueWithColumnName(column.name, value);
    });
  }

  private async addFeaturesToTable(
    tableName: string,
    features: Feature[],
    featureType: FeatureType,
  ): Promise<void> {
    if (!this.geoPackage || features.length === 0) {
      return;
    }

    // Get column definitions based on feature type
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

    // Check if table already exists
    const tableExists = this.geoPackage.isTable(tableName);

    if (!tableExists) {
      // Create the feature table
      this.geoPackage.createFeatureTable(
        tableName,
        geometryColumns,
        columns,
        boundingBox,
        4326,
      );
    }

    const featureDao = this.geoPackage.getFeatureDao(tableName);

    // Add features to the table
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const featureRow = featureDao.newRow();

      try {
        // Set geometry using wkx library to convert from GeoJSON
        let geometry = feature.geometry;

        // Convert Polygon to MultiPolygon
        if (geometry.type === "Polygon") {
          geometry = {
            type: "MultiPolygon",
            coordinates: [geometry.coordinates],
          };
        }

        const wkxGeometry = wkx.Geometry.parseGeoJSON(geometry);
        const geometryData = new GeometryData();
        geometryData.setSrsId(4326);
        geometryData.setGeometry(wkxGeometry);
        featureRow.geometry = geometryData;

        // Set properties based on feature type
        if (feature.properties) {
          this.setFeatureRowValues(
            featureRow,
            feature.properties as FeaturePropertiesMap[typeof featureType],
            featureType,
          );
        }

        featureDao.create(featureRow);
      } catch (error) {
        console.error(
          `Error processing feature ${i} in table ${tableName}:`,
          error,
        );
        throw error;
      }
    }
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
      await this.geoPackage.close();
      this.geoPackage = null;
    }
  }
}

export function createGeoPackageWriteStream(
  geoPackagePath: string,
  layerName: string,
  featureType: FeatureType,
): Transform {
  let features: Feature[] = [];
  let writer: GeoPackageWriter | null = null;

  return new Transform({
    objectMode: true,
    async transform(chunk: any, encoding, callback) {
      try {
        // Parse the GeoJSON if it's a string
        const data = typeof chunk === "string" ? JSON.parse(chunk) : chunk;

        if (data.type === "FeatureCollection" && data.features) {
          features.push(...data.features);
        } else if (data.type === "Feature") {
          features.push(data);
        }

        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    async flush(callback) {
      try {
        if (features.length > 0) {
          writer = new GeoPackageWriter();
          await writer.initialize(geoPackagePath);
          await writer.addFeatureLayer(layerName, features, featureType);
          await writer.close();
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

export async function convertGeoJSONToGeoPackage(
  geoJSONPath: string,
  geoPackagePath: string,
  layerName: string,
  featureType: FeatureType,
): Promise<void> {
  const features: Feature[] = [];

  await pipeline(
    readGeoJSONFeatures(geoJSONPath),
    new Transform({
      objectMode: true,
      transform(feature: Feature, encoding, callback) {
        features.push(feature);
        callback();
      },
    }),
  );

  const writer = new GeoPackageWriter();
  await writer.initialize(geoPackagePath);
  await writer.addFeatureLayer(layerName, features, featureType);
  await writer.close();
}
