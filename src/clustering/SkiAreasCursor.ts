import { SkiAreaObject } from "./MapObject";

export interface SkiAreasCursor {
  all(): Promise<SkiAreaObject[]>;
  next(): Promise<SkiAreaObject | undefined>;
  nextBatch(): Promise<SkiAreaObject[] | undefined>;
}

export function emptySkiAreasCursor(): SkiAreasCursor {
  return {
    all: async () => {
      return [];
    },
    next: async () => {
      return undefined;
    },
    nextBatch: async () => {
      return undefined;
    },
  };
}
