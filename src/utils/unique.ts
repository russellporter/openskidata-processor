export default function unique<T>(input: T[]): T[] {
  return Array.from(new Set(input));
}
