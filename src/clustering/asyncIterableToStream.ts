import { Readable } from "stream";

export function asyncIterableToStream<T>(iterable: AsyncIterable<T>): Readable {
  const iterator = iterable[Symbol.asyncIterator]();

  return new Readable({
    objectMode: true,
    read: function (this: Readable, _) {
      const readable = this;
      iterator
        .next()
        .catch((_: any) => {
          console.log("Failed reading from database, stopping.");
          readable.push(null);
          return undefined as any;
        })
        .then((result: IteratorResult<T> | undefined) => {
          if (result) {
            readable.push(result.done ? null : result.value);
          }
        });
    },
  });
}
