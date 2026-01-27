import centroid from "@turf/centroid";
import {
  AvalancheTransceiverCheckpointSpotProperties,
  AvalancheTransceiverTrainingSpotProperties,
  CrossingSpotProperties,
  DismountRequirement,
  FeatureType,
  HalfpipeSpotProperties,
  LiftStationPosition,
  LiftStationSpotProperties,
  SourceType,
  SpotFeature,
  SpotType,
} from "openskidata-format";
import { osmID } from "../features/OSMGeoJSONProperties";
import { InputSpotFeature, OSMSpotTags } from "../features/SpotFeature";
import buildFeature from "./FeatureBuilder";
import { getOSMName } from "./OSMTransforms";

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

type CommonSpotProperties = "id" | "skiAreas" | "sources" | "places";

export function formatSpots(feature: InputSpotFeature): SpotFeature[] {
  const tags = feature.properties.tags || {};

  // Convert all geometries to Point
  const geometry = centroid(feature).geometry;

  // Common properties for all spot types
  const commonProperties = {
    skiAreas: [],
    sources: [
      { type: SourceType.OPENSTREETMAP, id: osmID(feature.properties) },
    ],
    places: [],
  };

  // Call all format functions and collect non-null results
  const formatFunctions = [
    formatCrossing,
    formatLiftStation,
    formatAvalancheTransceiverTraining,
    formatAvalancheTransceiverCheckpoint,
    formatHalfpipe,
  ];

  const spots: SpotFeature[] = [];
  for (const formatFunction of formatFunctions) {
    const properties = formatFunction(tags);
    if (properties) {
      spots.push(
        buildFeature(geometry, { ...properties, ...commonProperties }),
      );
    }
  }

  return spots;
}

function formatCrossing(
  tags: OSMSpotTags,
): Omit<CrossingSpotProperties, CommonSpotProperties> | null {
  const dismountValue = tags["piste:dismount"];

  if (!dismountValue) {
    return null;
  }

  // Validate dismount value
  if (
    dismountValue !== "yes" &&
    dismountValue !== "no" &&
    dismountValue !== "sometimes"
  ) {
    return null;
  }

  return {
    type: FeatureType.Spot,
    spotType: SpotType.Crossing,
    dismount: dismountValue as DismountRequirement,
  };
}

function formatLiftStation(
  tags: OSMSpotTags,
): Omit<LiftStationSpotProperties, CommonSpotProperties> | null {
  if (tags.aerialway !== "station") {
    return null;
  }

  const name = getOSMName(tags, "name", null, null);

  // Parse position
  let position: LiftStationPosition | null = null;
  const stationValue = tags["aerialway:station"];
  if (
    stationValue === "top" ||
    stationValue === "mid" ||
    stationValue === "bottom"
  ) {
    position = stationValue as LiftStationPosition;
  }

  // Parse entry/exit
  let entry: boolean | null = null;
  let exit: boolean | null = null;
  const accessValue = tags["aerialway:access"];
  if (accessValue === "both") {
    entry = true;
    exit = true;
  } else if (accessValue === "entry") {
    entry = true;
    exit = false;
  } else if (accessValue === "exit") {
    entry = false;
    exit = true;
  } else if (accessValue === "no") {
    entry = false;
    exit = false;
  }

  return {
    type: FeatureType.Spot,
    spotType: SpotType.LiftStation,
    name,
    position,
    entry,
    exit,
  };
}

function formatAvalancheTransceiverTraining(
  tags: OSMSpotTags,
): Omit<
  AvalancheTransceiverTrainingSpotProperties,
  CommonSpotProperties
> | null {
  if (
    tags.amenity !== "avalanche_transceiver" ||
    tags.avalanche_transceiver !== "training"
  ) {
    return null;
  }

  return {
    type: FeatureType.Spot,
    spotType: SpotType.AvalancheTransceiverTraining,
  };
}

function formatAvalancheTransceiverCheckpoint(
  tags: OSMSpotTags,
): Omit<
  AvalancheTransceiverCheckpointSpotProperties,
  CommonSpotProperties
> | null {
  if (
    tags.amenity !== "avalanche_transceiver" ||
    tags.avalanche_transceiver !== "checkpoint"
  ) {
    return null;
  }

  return {
    type: FeatureType.Spot,
    spotType: SpotType.AvalancheTransceiverCheckpoint,
  };
}

function formatHalfpipe(
  tags: OSMSpotTags,
): Omit<HalfpipeSpotProperties, CommonSpotProperties> | null {
  if (tags.man_made !== "piste:halfpipe") {
    return null;
  }

  return {
    type: FeatureType.Spot,
    spotType: SpotType.Halfpipe,
  };
}
