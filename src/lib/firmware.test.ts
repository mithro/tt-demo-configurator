// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sdkMajor, upgradeFor } from './firmware';

describe('firmware versions', () => {
  it('reads release numbers, and nothing else, as releases', () => {
    expect(sdkMajor('2.0.4')).toBe(2);
    expect(sdkMajor('v3.1.1')).toBe(3);
    for (const v of ['0.0.0', 'abc', '', null]) expect(sdkMajor(v), String(v)).toBeNull();
  });
  it('offers the newer release for the board’s own chip only', () => {
    expect(upgradeFor('RP2040', '2.0.3')?.uf2).toBe('tt-demo-rp2040-v2.0.4.uf2');
    expect(upgradeFor('RP2350', '3.0.7')?.uf2).toBe('tt-demo-rp2350-v3.1.1.uf2');
    expect(upgradeFor('RP2040', '2.0.4')).toBeNull();
    expect(upgradeFor('RP2350', '3.1.1')).toBeNull();
    expect(upgradeFor(null, '2.0.0')).toBeNull();
  });
  it('offers no upgrade to a build from source (0.0.0), which is let through as supported too', () => {
    expect(upgradeFor('RP2040', '0.0.0')).toBeNull();
    expect(upgradeFor('RP2350', '0.0.0')).toBeNull();
  });
});
