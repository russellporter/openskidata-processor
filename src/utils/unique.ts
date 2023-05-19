export default function unique<T>(input: T[]): T[] {
  return [...new Set(input)];
}
