/**
 * A region a roster entry may be located in. Ski areas are matched only within their region,
 * which is the main defence against matching a same-named ski area on another continent.
 */
export interface SkiPassRegion {
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** ISO 3166-2 subdivision code, when the chart names a subdivision. */
  subdivision: string | null;
}

const usStates: { [name: string]: string } = {
  Alaska: "AK",
  Arizona: "AZ",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Missouri: "MO",
  Montana: "MT",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oregon: "OR",
  Pennsylvania: "PA",
  "South Dakota": "SD",
  Tennessee: "TN",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};

const canadianProvinces: { [name: string]: string } = {
  Alberta: "AB",
  "British Columbia": "BC",
  "Newfoundland & Labrador": "NL",
  "Newfoundland and Labrador": "NL",
  "Nova Scotia": "NS",
  Ontario: "ON",
  Quebec: "QC",
  Québec: "QC",
};

// ISO 3166-2:JP codes are numeric rather than derived from the prefecture name.
const japanesePrefectures: { [name: string]: string } = {
  Hokkaido: "JP-01",
  Aomori: "JP-02",
  Iwate: "JP-03",
  Miyagi: "JP-04",
  Akita: "JP-05",
  Yamagata: "JP-06",
  Fukushima: "JP-07",
  Gunma: "JP-10",
  Niigata: "JP-15",
  Nagano: "JP-20",
  Gifu: "JP-21",
};

const europeanCountries: { [name: string]: string } = {
  Andorra: "AD",
  Austria: "AT",
  "Czech Republic": "CZ",
  Czechia: "CZ",
  Finland: "FI",
  France: "FR",
  Germany: "DE",
  Italy: "IT",
  Norway: "NO",
  Scotland: "GB",
  Slovenia: "SI",
  Spain: "ES",
  Sweden: "SE",
  Switzerland: "CH",
  Turkey: "TR",
};

const standaloneCountries: { [name: string]: string } = {
  Australia: "AU",
  Chile: "CL",
  China: "CN",
  Japan: "JP",
  "New Zealand": "NZ",
  "South Korea": "KR",
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parsePart(part: string): SkiPassRegion {
  const value = collapseWhitespace(part);

  // "Japan (Nagano)"
  const japanMatch = value.match(/^Japan\s*\((.+)\)$/);
  if (japanMatch) {
    const prefecture = collapseWhitespace(japanMatch[1]);
    const subdivision = japanesePrefectures[prefecture];
    if (subdivision === undefined) {
      throw new Error(`Unknown Japanese prefecture in location: "${part}"`);
    }
    return { country: "JP", subdivision };
  }

  const standalone = standaloneCountries[value];
  if (standalone !== undefined) {
    return { country: standalone, subdivision: null };
  }

  // "Europe - Austria", "U.S. - Colorado", "Canada - Quebec", "China - Heibei"
  const separatorIndex = value.indexOf("-");
  if (separatorIndex === -1) {
    throw new Error(`Unrecognized ski pass chart location: "${part}"`);
  }
  const prefix = collapseWhitespace(value.slice(0, separatorIndex));
  const suffix = collapseWhitespace(value.slice(separatorIndex + 1));

  if (prefix === "Europe") {
    const country = europeanCountries[suffix];
    if (country === undefined) {
      throw new Error(`Unknown European country in location: "${part}"`);
    }
    return { country, subdivision: null };
  }

  if (prefix === "U.S." || prefix === "USA" || prefix === "US") {
    const state = usStates[suffix];
    if (state === undefined) {
      throw new Error(`Unknown U.S. state in location: "${part}"`);
    }
    return { country: "US", subdivision: `US-${state}` };
  }

  if (prefix === "Canada") {
    const province = canadianProvinces[suffix];
    if (province === undefined) {
      throw new Error(`Unknown Canadian province in location: "${part}"`);
    }
    return { country: "CA", subdivision: `CA-${province}` };
  }

  const country = standaloneCountries[prefix];
  if (country === undefined) {
    throw new Error(`Unrecognized ski pass chart location: "${part}"`);
  }
  // Subdivisions are only resolved for countries with a table above; for the rest the country
  // alone is a tight enough filter.
  return { country, subdivision: null };
}

/**
 * Parses a ski pass chart `Location` value into the regions a ski area may be in.
 *
 * A location may name more than one country when a ski area straddles a border, e.g.
 * "Europe - Switzerland, Europe - France".
 *
 * Throws on an unrecognized location so that a change to the chart fails the run rather than
 * silently widening the search to the whole world.
 */
export function parseSkiPassLocation(location: string): SkiPassRegion[] {
  const regions = location.split(",").map(parsePart);
  return regions.filter(
    (region, index) =>
      regions.findIndex(
        (other) =>
          other.country === region.country &&
          other.subdivision === region.subdivision,
      ) === index,
  );
}
