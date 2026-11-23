// SPDX-License-Identifier: Apache-2.0
// Firmware versions and downloads. Like the commander app, the newest release is a
// constant updated with each firmware release; flashing itself happens outside the
// browser (drag the .uf2 onto the board's USB drive).
//
// The two generations of demoboard run different SDK lines, and a .uf2 for one never
// boots on the other:
//   RP2040 (TT04/05 and TT06+ demoboards): SDK 2.x, last release v2.0.4. The SDK dropped
//     RP2040 support after that (2026-01-27, firmware commit 37cf3e8).
//   RP2350 (Tiny Tapeout Demoboard ETR, "TTDBv3"): SDK 3.x.

export type Mcu = 'RP2040' | 'RP2350';

const RELEASES = 'https://github.com/TinyTapeout/tt-micropython-firmware/releases';

export interface StockFirmware {
  /** The SDK major version this microcontroller runs. */
  sdkMajor: number;
  /** The oldest SDK release the app supports on it. */
  oldest: string;
  /** The newest stock release for it. */
  latest: string;
  /** Its release page. */
  url: string;
  /** The .uf2 to download from that page. */
  uf2: string;
}

export const STOCK_FIRMWARE: Record<Mcu, StockFirmware> = {
  RP2040: { sdkMajor: 2, oldest: '2.0.0', latest: '2.0.4', url: `${RELEASES}/tag/v2.0.4`, uf2: 'tt-demo-rp2040-v2.0.4.uf2' },
  RP2350: { sdkMajor: 3, oldest: '3.0.0', latest: '3.1.1', url: `${RELEASES}/tag/v3.1.1`, uf2: 'tt-demo-rp2350-v3.1.1.uf2' },
};

/** The demo-mode firmware has no release yet: it is built from this branch. RP2350 only. */
export const CUSTOM_FIRMWARE = {
  mcu: 'RP2350' as Mcu,
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

/**
 * The SDK's major version, or null if it isn't a release number. A build from source
 * reports "0.0.0" (the SDK's default when there is no release marker), which isn't one.
 * The one rule for both what the app supports and what it offers to upgrade.
 */
export function sdkMajor(sdk: string | null): number | null {
  const m = sdk?.match(/^v?(\d+)\./);
  const major = m ? parseInt(m[1], 10) : 0;
  return major > 0 ? major : null;
}

/** A newer stock release for this board's microcontroller, if there is one. */
export function upgradeFor(mcu: Mcu | null, sdk: string | null): StockFirmware | null {
  if (!mcu || !sdk || sdkMajor(sdk) === null) return null;
  const fw = STOCK_FIRMWARE[mcu];
  return compareVersions(sdk, fw.latest) < 0 ? fw : null;
}
