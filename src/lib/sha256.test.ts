// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HELPER_DEMO_PY } from './helper';
import { sha256Hex } from './sha256';

const node = (s: string) => createHash('sha256').update(s).digest('hex');

describe('sha256Hex', () => {
  it('matches the standard digest at every padding boundary and for UTF-8', () => {
    for (let n = 0; n < 200; n++) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s), String(n)).toBe(node(s));
    }
    expect(sha256Hex('ü ✓ — "quote"')).toBe(node('ü ✓ — "quote"'));
    expect(sha256Hex(HELPER_DEMO_PY.RP2040)).toBe(node(HELPER_DEMO_PY.RP2040));
  });
});
