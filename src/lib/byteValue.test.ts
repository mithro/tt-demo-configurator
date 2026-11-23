// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseByte } from './byteValue';

describe('parseByte', () => {
  it('reads decimal, hex and binary', () => {
    expect(parseByte('12')).toBe(12);
    expect(parseByte(' 0x0C ')).toBe(12);
    expect(parseByte('0b1100')).toBe(12);
    expect(parseByte('0b1111_0000')).toBe(240);
    expect(parseByte('0')).toBe(0);
    expect(parseByte('255')).toBe(255);
  });
  it('refuses what is not a byte', () => {
    for (const bad of ['', '256', '-1', '0x100', '0b', '0b102', '1.5', '12a', 'x', '0x']) expect(parseByte(bad)).toBeNull();
  });
});
