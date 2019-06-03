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
