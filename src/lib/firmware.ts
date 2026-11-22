// SPDX-License-Identifier: Apache-2.0
// Firmware versions and downloads. Like the commander app, the newest release is a
// constant updated with each firmware release; flashing itself happens outside the
// browser (drag the .uf2 onto the RP2350 drive).

/** The newest stock Tiny Tapeout SDK release for RP2350 boards. */
export const LATEST_STOCK = '3.1.1';
export const STOCK_RELEASE_URL = `https://github.com/TinyTapeout/tt-micropython-firmware/releases/tag/v${LATEST_STOCK}`;

/** The demo-mode firmware has no release yet: it is built from this branch. */
export const CUSTOM_FIRMWARE = {
  released: false,
  url: 'https://github.com/mithro/tt-micropython-firmware/tree/demo-shuttle-sequences',
};

/** -1, 0 or 1, comparing "3.0.7"-style versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function upgradeAvailable(sdk: string | null): boolean {
  return !!sdk && /^\d/.test(sdk) && compareVersions(sdk, LATEST_STOCK) < 0;
}
