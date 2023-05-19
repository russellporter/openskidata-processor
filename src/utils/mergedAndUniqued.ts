import unique from "./unique";

export default function mergedAndUniqued<T>(...values: T[][]): T[] {
  return unique(values.flat());
}
