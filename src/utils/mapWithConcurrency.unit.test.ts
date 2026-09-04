import { mapWithConcurrency } from "./mapWithConcurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves input order", async () => {
    const items = [5, 1, 4, 2, 3];

    const results = await mapWithConcurrency(items, 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item));
      return item * 2;
    });

    expect(results).toEqual([10, 2, 8, 4, 6]);
  });

  it("never exceeds the concurrency limit", async () => {
    const items = Array.from({ length: 50 }, (_, index) => index);
    let inFlight = 0;
    let peakInFlight = 0;

    await mapWithConcurrency(items, 4, async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
    });

    expect(peakInFlight).toBe(4);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  });

  it("rejects when an operation fails", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) {
          throw new Error("failed");
        }
        return item;
      }),
    ).rejects.toThrow("failed");
  });

  it("requires a concurrency of at least 1", async () => {
    await expect(
      mapWithConcurrency([1], 0, async (item) => item),
    ).rejects.toThrow("Concurrency must be at least 1");
  });
});
