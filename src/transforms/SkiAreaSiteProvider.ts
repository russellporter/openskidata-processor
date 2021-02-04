import { readFileSync } from "fs";
import {
  LiftFeature,
  RunFeature,
  SkiAreaFeature,
  SourceType,
} from "openskidata-format";
import { OSMSkiAreaSite } from "../features/SkiAreaFeature";
import { formatSkiArea, InputSkiAreaType } from "./SkiAreaFormatter";

export class SkiAreaSiteProvider {
  private all: SkiAreaFeature[] = [];
  private geoJSONByOSMID = new Map<string, SkiAreaFeature[]>();
  private format = formatSkiArea(InputSkiAreaType.OPENSTREETMAP_SITE);

  loadSites = (path: string) => {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const sites: OSMSkiAreaSite[] = json.elements;
    sites.forEach((site) => {
      const skiArea = this.format(site);
      if (skiArea) {
        this.all.push(skiArea);
        (site.members || []).forEach((member) => {
          const id = member.type + "/" + member.ref.toString();
          const memberSkiAreas = this.geoJSONByOSMID.get(id) || [];
          memberSkiAreas.push(skiArea);
          this.geoJSONByOSMID.set(id, memberSkiAreas);
        });
      } else {
        console.log(
          "Failed converting site to ski are: " + JSON.stringify(site)
        );
      }
    });
  };

  getSitesForObject = (osmID: string) => {
    return this.geoJSONByOSMID.get(osmID) || [];
  };

  getGeoJSONSites = () => this.all;
}

export function addSkiAreaSites(siteProvider: SkiAreaSiteProvider) {
  return (feature: RunFeature | LiftFeature) => {
    const osmIDs = feature.properties.sources
      .filter((source) => source.type == SourceType.OPENSTREETMAP)
      .map((source) => source.id);
    feature.properties.skiAreas = osmIDs.flatMap((osmID) =>
      siteProvider.getSitesForObject(osmID)
    );
    return feature;
  };
}
