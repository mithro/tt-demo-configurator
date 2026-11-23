// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { clocksPerPixel, decodeUo, rgbaLut, uoToRgb } from './tinyVga';

describe('decodeUo', () => {
  it('maps uo[0..7] = R1 G1 B1 VS R0 G0 B0 HS', () => {
    expect(decodeUo(0b0000_0001)).toEqual({ r: 2, g: 0, b: 0, hsync: false, vsync: false });
    expect(decodeUo(0b0001_0000)).toEqual({ r: 1, g: 0, b: 0, hsync: false, vsync: false });
    expect(decodeUo(0b0010_0010)).toEqual({ r: 0, g: 3, b: 0, hsync: false, vsync: false });
    expect(decodeUo(0b0100_0000)).toEqual({ r: 0, g: 0, b: 1, hsync: false, vsync: false });
    expect(decodeUo(0b0000_0100)).toEqual({ r: 0, g: 0, b: 2, hsync: false, vsync: false });
    expect(decodeUo(0x08)).toEqual({ r: 0, g: 0, b: 0, hsync: false, vsync: true });
    expect(decodeUo(0x80)).toEqual({ r: 0, g: 0, b: 0, hsync: true, vsync: false });
  });

  it('gives 8-bit levels 0/85/170/255', () => {
    expect(uoToRgb(0x77)).toEqual([255, 255, 255]);
    expect(uoToRgb(0x11)).toEqual([255, 0, 0]);
    expect(uoToRgb(0x10)).toEqual([85, 0, 0]);
    expect(uoToRgb(0x04)).toEqual([0, 0, 170]);
    expect(uoToRgb(0x88)).toEqual([0, 0, 0]);
  });

  it('packs RGBA for a little-endian Uint32Array over ImageData', () => {
    const lut = rgbaLut();
    const bytes = new Uint8Array(lut.buffer);
    const at = (uo: number) => [...bytes.slice(uo * 4, uo * 4 + 4)];
    expect(at(0x11)).toEqual([255, 0, 0, 255]);
    expect(at(0x22)).toEqual([0, 255, 0, 255]);
    expect(at(0x40)).toEqual([0, 0, 85, 255]);
    expect(at(0x88)).toEqual([0, 0, 0, 255]);
  });
});

describe('clocksPerPixel', () => {
  it('handles the pixel clock, 25 MHz and 50 MHz', () => {
    expect(clocksPerPixel(25_175_000)).toBe(1);
    expect(clocksPerPixel(25_000_000)).toBe(1);
    expect(clocksPerPixel(50_000_000)).toBe(2);
    expect(clocksPerPixel(50_350_000)).toBe(2);
  });
  it('refuses clocks a 640x480 monitor would not follow, and a stopped clock', () => {
    expect(clocksPerPixel(0)).toBeNull();
    expect(clocksPerPixel(10_000_000)).toBeNull();
    expect(clocksPerPixel(31_500_000)).toBeNull();
    expect(clocksPerPixel(40_000_000)).toBeNull();
  });
});
