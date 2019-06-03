import { Duplex, PassThrough, Transform, Writable } from "stream";
import Accumulator from "./accumulator/Accumulator";

export function map<X, Y>(mapper: (input: X) => Y): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      done(null, mapper(data));
    }
  });
}

export function mapAsync<X, Y>(mapper: (input: X) => Promise<Y>): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      mapper(data)
        .then(value => {
          done(null, value);
        })
        .catch(error => {
          done(error);
        });
    }
  });
}

export function get<X>(operation: (input: X) => void): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      operation(data);
      done(null, data);
    }
  });
}

export function getAsync<X>(
  mapper: ((input: X) => Promise<void>) | null
): Transform {
  if (!mapper) {
    return new PassThrough({ objectMode: true });
  }
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      mapper(data)
        .then(value => {
          done(null, data);
        })
        .catch(error => {
          done(error);
        });
    }
  });
}

export function andFinally<X>(mapper: (input: X) => Promise<void>): Writable {
  return new Writable({
    objectMode: true,
    write: (data: X, _, done) => {
      mapper(data)
        .then(value => {
          done();
        })
        .catch(error => {
          done(error);
        });
    }
  });
}

export function flatMap<X, Y>(mapper: (input: X) => Y | null): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      const result = mapper(data);

      result ? done(null, result) : done(null);
    }
  });
}

export function filter<X>(filter: (input: X) => Boolean): Transform {
  return new Transform({
    objectMode: true,
    transform: (data: X, _, done) => {
      filter(data) ? done(null, data) : done(null);
    }
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
    read() {}
  });
  duplex.on("finish", () => {
    accumulator.results().forEach(result => {
      duplex.push(result);
    });
    duplex.push(null);
  });

  return duplex;
}
