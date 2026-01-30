import {
  decodeMapboxElevation,
  elevationAtPixel,
  bilinearInterpolate,
} from "./ElevationDecoder";

describe("decodeMapboxElevation", () => {
  it("decodes sea level (0m)", () => {
    // 0 = -10000 + (r*65536 + g*256 + b) * 0.1
    // 10000 / 0.1 = 100000
    // 100000 = r*65536 + g*256 + b
    // r = 1, g = 134, b = 160 (1*65536 + 134*256 + 160 = 65536 + 34304 + 160 = 100000)
    const elevation = decodeMapboxElevation(1, 134, 160);
    expect(elevation).toBeCloseTo(0, 1);
  });

  it("decodes RGB (0, 0, 0) as -10000m", () => {
    const elevation = decodeMapboxElevation(0, 0, 0);
    expect(elevation).toBe(-10000);
  });

  it("decodes known elevation values", () => {
    // elevation = -10000 + (r*65536 + g*256 + b) * 0.1
    // For r=1, g=135, b=0: -10000 + (65536 + 34560 + 0) * 0.1 = -10000 + 10009.6 = 9.6
    const elevation = decodeMapboxElevation(1, 135, 0);
    expect(elevation).toBeCloseTo(9.6, 1);
  });

  it("decodes high elevation", () => {
    // Mount Everest ~8849m
    // 8849 = -10000 + value * 0.1 => value = 188490
    // 188490 = 2*65536 + 224*256 + 74
    const elevation = decodeMapboxElevation(2, 224, 74);
    expect(elevation).toBeCloseTo(8849, 1);
  });
});

describe("elevationAtPixel", () => {
  const channels = 3;

  function makeBuffer(pixels: [number, number, number][]): Buffer {
    const buf = Buffer.alloc(pixels.length * channels);
    for (let i = 0; i < pixels.length; i++) {
      buf[i * channels] = pixels[i][0];
      buf[i * channels + 1] = pixels[i][1];
      buf[i * channels + 2] = pixels[i][2];
    }
    return buf;
  }

  it("reads elevation at a specific pixel", () => {
    const seaLevel: [number, number, number] = [1, 134, 160]; // 0m
    const high: [number, number, number] = [1, 135, 0]; // 9.6m
    // 2x2 buffer: (0,0)=sea, (1,0)=high, (0,1)=sea, (1,1)=high
    const buf = makeBuffer([seaLevel, high, seaLevel, high]);

    expect(elevationAtPixel(buf, 0, 0, 2, channels)).toBeCloseTo(0, 1);
    expect(elevationAtPixel(buf, 1, 0, 2, channels)).toBeCloseTo(9.6, 1);
    expect(elevationAtPixel(buf, 0, 1, 2, channels)).toBeCloseTo(0, 1);
    expect(elevationAtPixel(buf, 1, 1, 2, channels)).toBeCloseTo(9.6, 1);
  });
});

describe("bilinearInterpolate", () => {
  it("returns e00 when fx=0 and fy=0", () => {
    expect(bilinearInterpolate(100, 200, 300, 400, 0, 0)).toBe(100);
  });

  it("returns e10 when fx=1 and fy=0", () => {
    expect(bilinearInterpolate(100, 200, 300, 400, 1, 0)).toBe(200);
  });

  it("returns e01 when fx=0 and fy=1", () => {
    expect(bilinearInterpolate(100, 200, 300, 400, 0, 1)).toBe(300);
  });

  it("returns e11 when fx=1 and fy=1", () => {
    expect(bilinearInterpolate(100, 200, 300, 400, 1, 1)).toBe(400);
  });

  it("interpolates horizontally at fy=0", () => {
    // At fx=0.5, fy=0: average of e00 and e10
    expect(bilinearInterpolate(0, 10, 0, 10, 0.5, 0)).toBeCloseTo(5);
  });

  it("interpolates vertically at fx=0", () => {
    // At fx=0, fy=0.5: average of e00 and e01
    expect(bilinearInterpolate(0, 10, 20, 30, 0, 0.5)).toBeCloseTo(10);
  });

  it("interpolates in both directions", () => {
    // All corners equal → result is that value
    expect(bilinearInterpolate(50, 50, 50, 50, 0.3, 0.7)).toBeCloseTo(50);

    // fx=0.5, fy=0.5 with values 0, 10, 20, 30
    // top = 0*0.5 + 10*0.5 = 5
    // bottom = 20*0.5 + 30*0.5 = 25
    // result = 5*0.5 + 25*0.5 = 15
    expect(bilinearInterpolate(0, 10, 20, 30, 0.5, 0.5)).toBeCloseTo(15);
  });
});
