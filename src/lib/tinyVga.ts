// SPDX-License-Identifier: Apache-2.0
// The Tiny VGA Pmod as seen from a design's outputs: uo[0..7] = R1 G1 B1 VS R0 G0 B0 HS,
// two bits per colour (R1 is the high bit), and the 640x480@60 timing it is built for.

export interface VgaPins {
  /** 0..3 */
  r: number;
  g: number;
  b: number;
  /** raw pin levels; the sync polarity is the design's choice (640x480 is normally active low) */
  hsync: boolean;
  vsync: boolean;
}

export function decodeUo(uo: number): VgaPins {
  return {
    r: (((uo >> 0) & 1) << 1) | ((uo >> 4) & 1),
    g: (((uo >> 1) & 1) << 1) | ((uo >> 5) & 1),
    b: (((uo >> 2) & 1) << 1) | ((uo >> 6) & 1),
    hsync: !!(uo & 0x80),
    vsync: !!(uo & 0x08),
  };
}

/** 2-bit colour level to 8 bits: 0, 85, 170, 255. */
export const level8 = (v: number): number => v * 85;

/** uo_out value to an RGB triple, as a screen on the Pmod would show it. */
export function uoToRgb(uo: number): [number, number, number] {
  const p = decodeUo(uo);
  return [level8(p.r), level8(p.g), level8(p.b)];
}

/**
 * uo_out value to an opaque pixel packed for a Uint32Array view of ImageData
 * (bytes R, G, B, A in memory, so little-endian 0xAABBGGRR).
 */
export function rgbaLut(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let uo = 0; uo < 256; uo++) {
    const [r, g, b] = uoToRgb(uo);
    lut[uo] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return lut;
}

/** 640x480@60 ("industry standard"), in pixel clocks and lines. */
export const VGA = {
  pixelHz: 25_175_000,
  width: 640,
  height: 480,
  hFront: 16,
  hSync: 96,
  hBack: 48,
  lineClocks: 800,
  vFront: 10,
  vSync: 2,
  vBack: 33,
  frameLines: 525,
} as const;

/**
 * How many design clocks make one pixel: 1 at 25.175 MHz (or the common 25 MHz), 2 at
 * 50 MHz. null when the clock is not close to a whole multiple of the pixel clock, which a
 * 640x480 monitor can't follow (or 0 Hz: the clock is stopped).
 */
export function clocksPerPixel(clockHz: number): number | null {
  if (!(clockHz > 0)) return null;
  const n = Math.round(clockHz / VGA.pixelHz);
  if (n < 1) return null;
  // monitors lock to roughly +-1% of the 31.47 kHz line rate; allow 2% for 25 MHz designs
  return Math.abs(clockHz / n - VGA.pixelHz) / VGA.pixelHz <= 0.02 ? n : null;
}
