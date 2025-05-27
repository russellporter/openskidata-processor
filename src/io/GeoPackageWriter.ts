import { Feature, FeatureCollection } from "geojson";
import { GeoPackageAPI, GeoPackage, GeometryColumns, GeometryData, GeometryType, BoundingBox } from "@ngageoint/geopackage";
import { FeatureType } from "openskidata-format";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { readGeoJSONFeatures } from "./GeoJSONReader";
import { existsSync } from "fs";
import wkx from "wkx";

export class GeoPackageWriter {
  private geoPackage: GeoPackage | null = null;

  constructor() {}

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
  }

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
    featureType: FeatureType
  ): Promise<void> {
    if (!this.geoPackage) {
      throw new Error("GeoPackage not initialized");
    }

    if (features.length === 0) {
      return;
    }

    // Get unique properties from all features
    const allProperties = new Map<string, Set<any>>();
    const propertyOrder: string[] = [];
    features.forEach(feature => {
      if (feature.properties) {
        Object.entries(feature.properties).forEach(([key, value]) => {
          if (!allProperties.has(key)) {
            allProperties.set(key, new Set());
            propertyOrder.push(key);
          }
          allProperties.get(key)!.add(typeof value);
        });
      }
    });

    // Create feature columns based on properties - use propertyOrder to maintain order
    const columns: {name: string, dataType: string}[] = [];
    const addedColumns = new Set<string>();
    
    propertyOrder.forEach(name => {
      if (addedColumns.has(name)) {
        console.warn(`Skipping duplicate column: ${name}`);
        return;
      }
      addedColumns.add(name);
      
      const types = allProperties.get(name)!;
      const typeArray = Array.from(types);
      let dataType = 'TEXT';
      
      if (typeArray.length === 1) {
        const type = typeArray[0];
        if (type === 'number') {
          dataType = 'REAL';
        } else if (type === 'boolean') {
          dataType = 'BOOLEAN';
        }
      }
      
      // Convert to snake_case and handle special cases
      let columnName = this.toSnakeCase(name);
      if (name.toLowerCase() === 'id') {
        columnName = 'feature_id';
      }
      columns.push({name: columnName, dataType});
    });

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    features.forEach(feature => {
      const coords = this.extractCoordinates(feature.geometry);
      coords.forEach(coord => {
        minX = Math.min(minX, coord[0]);
        maxX = Math.max(maxX, coord[0]);
        minY = Math.min(minY, coord[1]);
        maxY = Math.max(maxY, coord[1]);
      });
    });
    const boundingBox = new BoundingBox(minX, minY, maxX, maxY);

    // Create geometry columns
    const geometryColumns = new GeometryColumns();
    geometryColumns.table_name = layerName;
    geometryColumns.column_name = 'geometry';
    geometryColumns.geometry_type_name = this.getGeometryTypeName(features[0]);
    geometryColumns.srs_id = 4326; // WGS84
    geometryColumns.z = 0;
    geometryColumns.m = 0;

    
    // Check if table already exists
    const tableExists = this.geoPackage.isTable(layerName);
    
    if (!tableExists) {
      // Create the feature table
      this.geoPackage.createFeatureTable(layerName, geometryColumns, columns, boundingBox, 4326);
    }
    
    const featureDao = this.geoPackage.getFeatureDao(layerName);

    // Add features to the table
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const featureRow = featureDao.newRow();
      
      try {
        // Set geometry using wkx library to convert from GeoJSON
        const wkxGeometry = wkx.Geometry.parseGeoJSON(feature.geometry);
        const geometryData = new GeometryData();
        geometryData.setSrsId(4326);
        geometryData.setGeometry(wkxGeometry);
        featureRow.geometry = geometryData;
        
        // Set properties
        if (feature.properties) {
          Object.entries(feature.properties).forEach(([key, value]) => {
            // Convert to snake_case and handle special cases
            let columnName = this.toSnakeCase(key);
            if (key.toLowerCase() === 'id') {
              columnName = 'feature_id';
            }
            
            // Convert values for SQLite compatibility
            let finalValue = value;
            if (value === null || value === undefined) {
              finalValue = null;
            } else if (typeof value === 'boolean') {
              // SQLite doesn't have a boolean type, convert to integer
              finalValue = value ? 1 : 0;
            } else if (typeof value === 'object') {
              // Convert arrays and objects to JSON strings
              finalValue = JSON.stringify(value);
            }
            
            try {
              featureRow.setValueWithColumnName(columnName, finalValue);
            } catch (error) {
              console.error(`Error setting value for column ${columnName}:`, finalValue, error);
              throw error;
            }
          });
        }
        
        featureDao.create(featureRow);
      } catch (error) {
        console.error(`Error processing feature ${i} in layer ${layerName}:`, error);
        throw error;
      }
    }
  }

  private extractCoordinates(geometry: any): number[][] {
    const coords: number[][] = [];
    
    const extractFromCoordArray = (arr: any): void => {
      if (Array.isArray(arr)) {
        if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
          coords.push(arr);
        } else {
          arr.forEach(item => extractFromCoordArray(item));
        }
      }
    };

    if (geometry.coordinates) {
      extractFromCoordArray(geometry.coordinates);
    } else if (geometry.geometries) {
      geometry.geometries.forEach((g: any) => {
        const subCoords = this.extractCoordinates(g);
        coords.push(...subCoords);
      });
    }

    return coords;
  }

  private getGeometryTypeName(feature: Feature): string {
    switch (feature.geometry.type) {
      case 'Point':
        return 'POINT';
      case 'LineString':
        return 'LINESTRING';
      case 'Polygon':
        return 'POLYGON';
      case 'MultiPoint':
        return 'MULTIPOINT';
      case 'MultiLineString':
        return 'MULTILINESTRING';
      case 'MultiPolygon':
        return 'MULTIPOLYGON';
      case 'GeometryCollection':
        return 'GEOMETRYCOLLECTION';
      default:
        return 'GEOMETRY';
    }
  }

  private getGeometryType(feature: Feature): GeometryType {
    switch (feature.geometry.type) {
      case 'Point':
        return GeometryType.POINT;
      case 'LineString':
        return GeometryType.LINESTRING;
      case 'Polygon':
        return GeometryType.POLYGON;
      case 'MultiPoint':
        return GeometryType.MULTIPOINT;
      case 'MultiLineString':
        return GeometryType.MULTILINESTRING;
      case 'MultiPolygon':
        return GeometryType.MULTIPOLYGON;
      case 'GeometryCollection':
        return GeometryType.GEOMETRYCOLLECTION;
      default:
        return GeometryType.GEOMETRY;
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
  featureType: FeatureType
): Transform {
  let features: Feature[] = [];
  let writer: GeoPackageWriter | null = null;

  return new Transform({
    objectMode: true,
    async transform(chunk: any, encoding, callback) {
      try {
        // Parse the GeoJSON if it's a string
        const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
        
        if (data.type === 'FeatureCollection' && data.features) {
          features.push(...data.features);
        } else if (data.type === 'Feature') {
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
    }
  });
}

export async function convertGeoJSONToGeoPackage(
  geoJSONPath: string,
  geoPackagePath: string,
  layerName: string,
  featureType: FeatureType
): Promise<void> {
  const features: Feature[] = [];
  
  await pipeline(
    readGeoJSONFeatures(geoJSONPath),
    new Transform({
      objectMode: true,
      transform(feature: Feature, encoding, callback) {
        features.push(feature);
        callback();
      }
    })
  );

  const writer = new GeoPackageWriter();
  await writer.initialize(geoPackagePath);
  await writer.addFeatureLayer(layerName, features, featureType);
  await writer.close();
}