import unique from "../utils/unique";

export function mapOSMNumber(input: string | undefined): number | null {
  if (input === undefined) {
    return null;
  }
  const number = Number(input);
  if (isNaN(number)) {
    return null;
  }

  return number;
}

export function mapOSMBoolean(input: string | undefined): boolean | null {
  switch (input) {
    case "yes":
      return true;
    case "no":
      return false;
    default:
      return null;
  }
}

export function mapOSMString(input: string | undefined): string | null {
  return input === undefined ? null : input;
}

type OSMTags = Record<string, string | undefined>;

/**
 * Get the name of an object based on the OSM tags.
 * Extracts localized names as well.
 * If ref is provided and the name starts with the ref, the ref prefix is removed.
 */
export function getOSMName<Properties extends OSMTags>(
  properties: Properties,
  rootKey: Extract<keyof Properties, string>,
  fallbackRootKey: Extract<keyof Properties, string> | null = null,
  ref: string | null = null,
): string | null {
  const keys = sortedNameKeys(properties, rootKey, fallbackRootKey);

  if (keys.length === 0) {
    return null;
  }

  let name = unique(keys.map((key) => properties[key])).join(", ");

  // If ref exists and name starts with ref, remove the ref prefix
  if (ref && name) {
    // Check for various reference patterns: "11 - Peak Chair", "11-Peak Chair", "11- Peak Chair", "11 -Peak Chair", "11 Peak Chair"
    // Create a regex that matches ref followed by:
    // - optional spaces, then optional dash, then spaces
    // - OR dash, then optional spaces
    const refPrefixRegex = new RegExp(`^${ref}(\\s*-?\\s+|-\\s*)`);

    if (refPrefixRegex.test(name)) {
      name = name.replace(refPrefixRegex, "");
    }
  }

  return name;
}

export function getOSMFirstValue<Properties extends OSMTags>(
  properties: Properties,
  key: Extract<keyof Properties, string>,
): string | null {
  const input = properties[key];
  if (input === undefined) {
    return null;
  }

  let values = input.split(";");
  if (values.length > 1) {
    console.log(`Ignoring following values for ${key}: ${input}`);
  }
  return values[0];
}

/**
 * Get the first defined value from a list of keys in priority order.
 */
export function getOrElse<P extends { [key: string]: string | undefined }>(
  properties: P,
  ...keys: (keyof P)[]
): string | undefined {
  for (const key of keys) {
    const value = properties[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Get the ref of an object based on the OSM tags.
 * Priority order: piste:loc_ref > piste:ref > loc_ref > ref
 */
export function getOSMRef<Properties extends OSMTags>(
  properties: Properties,
): string | null {
  return mapOSMString(
    getOrElse(properties, "piste:loc_ref", "piste:ref", "loc_ref", "ref"),
  );
}

function nameKeysForRootKey<Properties extends OSMTags>(
  properties: Properties,
  rootKey: Extract<keyof Properties, string>,
): (keyof Properties)[] {
  return Object.keys(properties).filter(
    (key) => key === rootKey || key.startsWith(`${rootKey}:`),
  );
}

function sortedNameKeys<Properties extends OSMTags>(
  properties: Properties,
  rootKey: Extract<keyof Properties, string>,
  fallbackRootKey: Extract<keyof Properties, string> | null = null,
): (keyof Properties)[] {
  let keys = nameKeysForRootKey(properties, rootKey);
  if (keys.length == 0 && fallbackRootKey !== null) {
    keys = nameKeysForRootKey(properties, fallbackRootKey);
  }

  return keys.sort();
}
