import { SkiAreaObject } from "./MapObject";

export interface SkiAreasCursor {
  all(): Promise<SkiAreaObject[]>;
  next(): Promise<SkiAreaObject | null>;
  batches?: {
    next(): Promise<SkiAreaObject[] | null>;
  };
}

export function emptySkiAreasCursor(): SkiAreasCursor {
  return {
    all: async () => {
      return [];
    },
    next: async () => {
      return null;
    },
  };
}
