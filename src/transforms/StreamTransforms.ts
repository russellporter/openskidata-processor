import { Duplex, PassThrough, Readable, Transform, Writable } from "stream";
import Accumulator from "./accumulator/Accumulator";

export function map<X, Y>(mapper: (input: X) => Y): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      done(null, mapper(data));
    },
  });
}

/**
 * Maps each item through an async function, running up to `parallelism` of them
 * at once while still emitting results in input order.
 *
 * Replaces the `parallel-transform` package. Note that a mapper returning null
 * or undefined drops the item rather than emitting it, which callers rely on;
 * Node's own `Readable.prototype.map` cannot express that, because writing null
 * to a stream throws ERR_STREAM_NULL_VALUES.
 */
export function mapAsync<X, Y>(
  mapper: ((input: X) => Promise<Y>) | null,
  parallelism: number = 1,
): Transform {
  if (!mapper) {
    return passThrough();
  }

  interface Slot {
    settled: boolean;
    failed: boolean;
    value?: Y;
    error?: unknown;
  }

  // Results are held in input order and only released from the head, so a slow
  // item cannot be overtaken by a later one that finished first.
  const slots: Slot[] = [];
  let inFlight = 0;
  let releaseBackpressure: (() => void) | null = null;
  let finish: (() => void) | null = null;

  const settle = () => {
    inFlight--;

    while (slots.length > 0 && slots[0].settled) {
      const slot = slots.shift()!;
      if (slot.failed) {
        stream.destroy(
          slot.error instanceof Error
            ? slot.error
            : new Error(String(slot.error)),
        );
        return;
      }
      if (slot.value !== null && slot.value !== undefined) {
        stream.push(slot.value);
      }
    }

    const release = releaseBackpressure;
    releaseBackpressure = null;
    release?.();

    if (finish !== null && slots.length === 0 && inFlight === 0) {
      const done = finish;
      finish = null;
      done();
    }
  };

  const stream: Transform = new Transform({
    objectMode: true,
    transform(data: X, _, done) {
      const slot: Slot = { settled: false, failed: false };
      slots.push(slot);
      inFlight++;

      mapper(data).then(
        (value) => {
          slot.settled = true;
          slot.value = value;
          settle();
        },
        (error) => {
          slot.settled = true;
          slot.failed = true;
          slot.error = error;
          settle();
        },
      );

      // Accept the next item immediately while there is spare capacity;
      // otherwise hold the callback until an in-flight item completes.
      if (inFlight < parallelism) {
        done();
      } else {
        releaseBackpressure = done;
      }
    },
    flush(done) {
      if (slots.length === 0 && inFlight === 0) {
        done();
      } else {
        finish = done;
      }
    },
  });

  return stream;
}

export function get<X>(operation: (input: X) => void): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      operation(data);
      done(null, data);
    },
  });
}

export function andFinally<X>(mapper: (input: X) => Promise<void>): Writable {
  return new Writable({
    objectMode: true,
    write: (data: X, _, done) => {
      mapper(data)
        .then((value) => {
          done();
        })
        .catch((error) => {
          done(error);
        });
    },
  });
}

export function flatMap<X, Y>(mapper: (input: X) => Y | null): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      const result = mapper(data);

      result ? done(null, result) : done(null);
    },
  });
}

export function flatMapArray<X, Y>(mapper: (input: X) => Y[]): Transform {
  return new Transform({
    objectMode: true,
    transform: function (data: X, _, done) {
      const results = mapper(data);

      // Push each item in the array separately
      results.forEach((item) => this.push(item));
      done(null);
    },
  });
}

export function filter<X>(filter: (input: X) => Boolean): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      filter(data) ? done(null, data) : done(null);
    },
  });
}

export function accumulate<X, Y>(accumulator: Accumulator<X, Y>): Duplex {
  const duplex = new Duplex({
    readableObjectMode: true,
    writableObjectMode: true,
    write: (data: X, _, done) => {
      accumulator.accumulate(data);
      done();
    },
    read() {},
  });
  duplex.on("finish", () => {
    accumulator.results().forEach((result) => {
      duplex.push(result);
    });
    duplex.push(null);
  });

  return duplex;
}

export function passThrough(): Transform {
  return new PassThrough({ objectMode: true });
}

/**
 * Concatenates object streams end to end, in the order given.
 *
 * Replaces `merge2`, which — when handed an array, as it was here — interleaved
 * its inputs as they happened to produce data. That made the output order, and
 * therefore the order in which downstream statistics accumulate floating point
 * sums, vary between runs of the same input.
 */
export function concat(...sources: NodeJS.ReadableStream[]): Readable {
  return Readable.from(
    (async function* () {
      for (const source of sources) {
        yield* source;
      }
    })(),
    { objectMode: true },
  );
}
