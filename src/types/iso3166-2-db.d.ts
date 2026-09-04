// iso3166-2-db ships no types and has no @types package. Declared as an ambient
// module inside src/ rather than as a standalone .d.ts reached through a tsconfig
// "paths" mapping, because TypeScript 7 removed baseUrl.
declare module "iso3166-2-db" {
  export function changeDispute(dispute: string): void;

  export function changeNameProvider(
    nameProvider: "geonames" | "osm" | "wikipedia",
  ): void;

  export type Country = {
    iso: string;
    names: { en: string };
    regions: Region[];
  };

  export type Region = {
    name: string;
    iso: string;
  };

  export function findCountryByName(name: string): Country | null;
  export function findRegionByCode(iso3166_2Code: string): Region[];
  export function getDataSet(dispute?: string, dataset?: any): any;

  export function getRegionsFor(countryIsoCode: any): any;

  export function reduce(
    dataset: any,
    lang: any,
    countryList: any,
    ...args: any[]
  ): any;
}
