import { pipeline } from "stream/promises";
import { Readable, Writable } from "stream";
import { mapAsync } from "./StreamTransforms.js";

async function collect<T>(
  input: T[],
  transform: NodeJS.ReadWriteStream,
): Promise<T[]> {
  const output: T[] = [];
  await pipeline(
    Readable.from(input),
    transform,
    new Writable({
      objectMode: true,
      write(chunk, _, done) {
        output.push(chunk);
        done();
      },
    }),
  );
  return output;
}

describe("mapAsync", () => {
  it("preserves input order even when later items settle first", async () => {
    // Item 1 takes the longest, so an unordered implementation would emit it last.
    const output = await collect(
      [1, 2, 3, 4, 5],
      mapAsync(async (n: number) => {
        await new Promise((resolve) => setTimeout(resolve, (6 - n) * 10));
        return n;
      }, 5),
    );
    expect(output).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it("drops items whose mapper resolves to null or undefined", async () => {
    const output = await collect(
      [1, 2, 3, 4],
      mapAsync(
        async (n: number) =>
          (n === 2 ? null : n === 3 ? undefined : n) as number,
        2,
      ),
    );
    expect(output).toStrictEqual([1, 4]);
  });

  it("runs at most `parallelism` mappers concurrently", async () => {
    let active = 0;
    let peak = 0;
    await collect(
      [1, 2, 3, 4, 5, 6, 7, 8],
      mapAsync(async (n: number) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return n;
      }, 3),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("propagates mapper errors", async () => {
    await expect(
      collect(
        [1, 2, 3],
        mapAsync(async (n: number) => {
          if (n === 2) throw new Error("boom");
          return n;
        }, 2),
      ),
    ).rejects.toThrow("boom");
  });

  it("passes items through unchanged when the mapper is null", async () => {
    expect(
      await collect([1, 2, 3], mapAsync<number, number>(null)),
    ).toStrictEqual([1, 2, 3]);
  });

  it("handles an empty stream", async () => {
    expect(
      await collect(
        [],
        mapAsync(async (n: number) => n, 4),
      ),
    ).toStrictEqual([]);
  });
});
