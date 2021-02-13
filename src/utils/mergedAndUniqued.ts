export default function mergedAndUniqued<T>(...values: T[][]): T[] {
  return Array.from(new Set(values.flat()));
}
