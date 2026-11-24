// SPDX-License-Identifier: Apache-2.0
// Clock frequencies for people: VGA designs run at MHz, but FPGA demos and slow counters at Hz.

/** "25.175 MHz", "31.5 kHz", "10 Hz": the largest unit that keeps the number at least 1. */
export function formatHz(hz: number): string {
  const [scale, unit] = hz >= 1e6 ? [1e6, 'MHz'] : hz >= 1e3 ? [1e3, 'kHz'] : [1, 'Hz'];
  return `${+(hz / scale).toFixed(3)} ${unit}`;
}
