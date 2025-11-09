import { Place } from "openskidata-format";

/**
 * Sorts places alphabetically by locality, then region, then country.
 * Handles null values by placing them after non-null values.
 */
export function sortPlaces(places: Place[]): Place[] {
  return [...places].sort((a, b) => {
    // Compare locality
    const localityA = a.localized.en.locality;
    const localityB = b.localized.en.locality;

    // null localities go to the end
    if (localityA === null && localityB === null) {
      // Continue to region comparison
    } else if (localityA === null) {
      return 1;
    } else if (localityB === null) {
      return -1;
    } else if (localityA !== localityB) {
      return localityA.localeCompare(localityB);
    }

    // Compare region
    const regionA = a.localized.en.region;
    const regionB = b.localized.en.region;

    // null regions go to the end
    if (regionA === null && regionB === null) {
      // Continue to country comparison
    } else if (regionA === null) {
      return 1;
    } else if (regionB === null) {
      return -1;
    } else if (regionA !== regionB) {
      return regionA.localeCompare(regionB);
    }

    // Compare country
    const countryA = a.localized.en.country;
    const countryB = b.localized.en.country;

    return countryA.localeCompare(countryB);
  });
}

/**
 * Deduplicates places based on their unique identifying properties.
 * Uses iso3166_1Alpha2, iso3166_2, and locality as the unique key.
 */
export function uniquePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();

  return places.filter((place) => {
    // Create a unique key from the place's identifying properties
    const key = JSON.stringify({
      iso3166_1Alpha2: place.iso3166_1Alpha2,
      iso3166_2: place.iso3166_2,
      locality: place.localized.en.locality,
    });

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
