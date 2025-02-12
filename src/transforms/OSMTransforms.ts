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
 */
export function getOSMName<Properties extends OSMTags>(
  properties: Properties,
  rootKey: Extract<keyof Properties, string>,
  fallbackRootKey: Extract<keyof Properties, string> | null = null,
): string | null {
  const keys = sortedNameKeys(properties, rootKey, fallbackRootKey);

  if (keys.length === 0) {
    return null;
  }

  return unique(keys.map((key) => properties[key])).join(", ");
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
