// SPDX-License-Identifier: Apache-2.0
// An 8-bit input value typed as a number: decimal, 0x hex or 0b binary.

/** The value 0–255 that `text` spells (e.g. "12", "0x0c", "0b1100"), or null if it isn't one. */
export function parseByte(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/_/g, '');
  const m = /^(?:0x([0-9a-f]+)|0b([01]+)|([0-9]+))$/.exec(t);
  if (!m) return null;
  const n = m[1] !== undefined ? parseInt(m[1], 16) : m[2] !== undefined ? parseInt(m[2], 2) : parseInt(m[3], 10);
  return n >= 0 && n <= 255 ? n : null;
}
