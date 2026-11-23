// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { rgbaLut } from '~/lib/tinyVga';
import { Crt } from './crt';

const LUT = rgbaLut();

/** uo_out of an hvsync_generator-style 640x480 design, at pixel (h, v) of the raster. */
function signal(h: number, v: number, activeHigh: boolean, colour: (x: number, y: number) => number): number {
  const hs = h >= 656 && h < 752;
  const vs = v >= 490 && v < 492;
  const hBit = hs === activeHigh ? 0x80 : 0;
  const vBit = vs === activeHigh ? 0x08 : 0;
  const rgb = h < 640 && v < 480 ? colour(h, v) & 0x77 : 0;
  return hBit | vBit | rgb;
}

function run(crt: Crt, frames: number, div: number, activeHigh: boolean, colour: (x: number, y: number) => number) {
  let done = 0;
  for (let f = 0; f < frames; f++)
    for (let v = 0; v < 525; v++)
      for (let h = 0; h < 800; h++) for (let k = 0; k < div; k++) if (crt.feed(signal(h, v, activeHigh, colour))) done++;
  return done;
}

const pattern = (x: number, y: number) => ((x >> 4) ^ (y >> 3)) & 0x77;

describe('Crt', () => {
  it('draws the active area of a standard active-low signal', () => {
    const crt = new Crt(25_175_000);
    expect(run(crt, 3, 1, false, pattern)).toBe(3);
    expect(crt.standard()).toBe(true);
    expect(crt.stats()).toMatchObject({ lineClocks: 800, frameLines: 525, hsyncActiveHigh: false, vsyncActiveHigh: false });
    for (const [x, y] of [[0, 0], [639, 0], [0, 479], [639, 479], [320, 240], [17, 33]])
      expect(crt.pixels[y * 640 + x], `pixel ${x},${y}`).toBe(LUT[pattern(x, y)]);
  });

  it('follows active-high sync too', () => {
    const crt = new Crt(25_175_000);
    run(crt, 3, 1, true, pattern);
    expect(crt.stats()).toMatchObject({ hsyncActiveHigh: true, vsyncActiveHigh: true });
    expect(crt.pixels[100 * 640 + 200]).toBe(LUT[pattern(200, 100)]);
    expect(crt.pixels[479 * 640 + 639]).toBe(LUT[pattern(639, 479)]);
  });

  it('draws a 50 MHz design (two clocks per pixel) at full size', () => {
    const crt = new Crt(50_350_000);
    run(crt, 3, 2, false, pattern);
    expect(crt.standard()).toBe(true);
    expect(crt.stats().lineClocks).toBe(1600);
    expect(crt.pixels[0]).toBe(LUT[pattern(0, 0)]);
    expect(crt.pixels[479 * 640 + 639]).toBe(LUT[pattern(639, 479)]);
  });

  it('samples by time, so a line of any length fills the screen', () => {
    // 800-clock lines clocked at 50 MHz: the monitor guessed 1600 clocks, then measures 800
    const crt = new Crt(50_350_000);
    run(crt, 3, 1, false, pattern);
    expect(crt.pixels[479 * 640 + 639]).toBe(LUT[pattern(639, 479)]);
    expect(crt.pixels[200 * 640 + 300]).toBe(LUT[pattern(300, 200)]);
  });

  it('flags timing a monitor would not expect', () => {
    // 800-clock lines at 50 MHz: a 62.9 kHz line rate
    const fast = new Crt(50_350_000);
    run(fast, 2, 1, false, pattern);
    expect(fast.standard()).toBe(false);
    expect(fast.stats().lineHz).toBeCloseTo(62_937.5, 0);
    // 1600-clock lines at 48 MHz: 30 kHz, 4.7% slow
    const slow = new Crt(48_000_000);
    run(slow, 2, 2, false, pattern);
    expect(slow.standard()).toBe(false);
    expect(slow.pixels[479 * 640 + 639]).toBe(LUT[pattern(639, 479)]);
  });
});
