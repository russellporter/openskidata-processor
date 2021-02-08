import { BatchedArrayCursor } from "arangojs/cursor";
import { SkiAreaObject } from "./MapObject";

export interface SkiAreasCursor {
  all(): Promise<SkiAreaObject[]>;
  next(): Promise<SkiAreaObject | undefined>;
  batches?: BatchedArrayCursor<SkiAreaObject>;
}

export function emptySkiAreasCursor(): SkiAreasCursor {
  return {
    all: async () => {
      return [];
    },
    next: async () => {
      return undefined;
    },
  };
}
