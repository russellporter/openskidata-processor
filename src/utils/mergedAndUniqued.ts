import unique from "./unique.js";

export default function mergedAndUniqued<T>(...values: T[][]): T[] {
  return unique(values.flat());
}
