export default interface Accumulator<X, Y> {
  accumulate: (input: X) => void;
  results: () => Y[];
}
