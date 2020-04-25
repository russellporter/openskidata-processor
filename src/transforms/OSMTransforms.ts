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

type OSMTags = { [key: string]: string | undefined };

/**
 * Get the name of an object based on the OSM tags.
 * Extracts localized names as well.
 */
export function getOSMName<Properties extends OSMTags>(
  properties: Properties,
  rootKey: keyof Properties,
  fallbackRootKey: keyof Properties | null = null
): string | null {
  const keys = sortedNameKeys(properties, rootKey, fallbackRootKey);

  if (keys.length === 0) {
    return null;
  }

  return keys
    .map(function (key) {
      return properties[key];
    })
    .join(", ");
}

function nameKeysForRootKey<Properties extends OSMTags>(
  properties: Properties,
  rootKey: keyof Properties
): (keyof Properties)[] {
  return Object.keys(properties).filter(
    (key) => key === rootKey || key.startsWith(rootKey + ":")
  );
}

function sortedNameKeys<Properties extends OSMTags>(
  properties: Properties,
  rootKey: keyof Properties,
  fallbackRootKey: keyof Properties | null = null
): (keyof Properties)[] {
  let keys = nameKeysForRootKey(properties, rootKey);
  if (keys.length == 0 && fallbackRootKey !== null) {
    keys = nameKeysForRootKey(properties, fallbackRootKey);
  }

  return keys.sort();
}
