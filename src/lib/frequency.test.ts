// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { formatHz } from './frequency';

describe('formatHz', () => {
  it('picks the unit that keeps slow clocks readable', () => {
    expect(formatHz(25_175_000)).toBe('25.175 MHz');
    expect(formatHz(25_000_000)).toBe('25 MHz');
    expect(formatHz(31_500)).toBe('31.5 kHz');
    expect(formatHz(10)).toBe('10 Hz');
    expect(formatHz(1_000)).toBe('1 kHz');
    expect(formatHz(1_234_567)).toBe('1.235 MHz');
  });
});
