// SPDX-License-Identifier: Apache-2.0
// Importing the hand-made Shenzhen demos: a board's /vga_cycle.py with
//   VGA_DESIGNS = [('tt_um_macro', ui_in[, player]), ...]
// becomes a demo.json. Game players become empty "steps", flagged so the user can pick a
// script.
import type { DemoFile, Entry } from './demoFile';
import type { Project } from './shuttleIndex';

export interface HandmadeEntry {
  macro: string;
  ui_in: number;
  player: string | null;
}

/** Evaluate the small integer expressions vga_cycle.py uses: 0, 0b111, 7, C4_IDLE, 0b1_1111. */
function evalInt(expr: string, consts: Record<string, number>): number | null {
  const e = expr.trim().replace(/_/g, (m, i, s) => (/[0-9a-fA-FxXbBoO]/.test(s[i - 1] ?? '') ? '' : m));
  if (/^0[bB][01]+$/.test(e)) return parseInt(e.slice(2), 2);
  if (/^0[xX][0-9a-fA-F]+$/.test(e)) return parseInt(e.slice(2), 16);
  if (/^0[oO][0-7]+$/.test(e)) return parseInt(e.slice(2), 8);
  if (/^\d+$/.test(e)) return parseInt(e, 10);
  return expr.trim() in consts ? consts[expr.trim()] : null;
}

export function parseVgaCycle(src: string): HandmadeEntry[] {
  const consts: Record<string, number> = {};
  for (const m of src.matchAll(/^([A-Z][A-Z0-9_]*)\s*=\s*([0-9][0-9a-fA-FxXbBoO_]*)/gm)) {
    const v = evalInt(m[2], consts);
    if (v !== null) consts[m[1]] = v;
  }
  const list = src.match(/^VGA_DESIGNS\s*=\s*\[([\s\S]*?)^\]/m);
  if (!list) throw new Error('no VGA_DESIGNS list in vga_cycle.py');
  const out: HandmadeEntry[] = [];
  for (const m of list[1].matchAll(/\(\s*['"]([^'"]+)['"]\s*,\s*([^,)]+?)\s*(?:,\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?\)/g)) {
    const ui = evalInt(m[2], consts);
    if (ui === null) throw new Error(`vga_cycle.py: can't read the ui_in value "${m[2]}" of ${m[1]}`);
    out.push({ macro: m[1], ui_in: ui, player: m[3] ?? null });
  }
  return out;
}

export interface ImportResult {
  file: DemoFile;
  /** Entries whose hand-made player needs a step script. */
  needsScript: { index: number; macro: string; player: string }[];
  /** Macros the shuttle index doesn't have. */
  missing: string[];
}

export const VGA_CLOCK_HZ = 25_175_000;
export const DEFAULT_DURATION_MS = 15_000;

export function importHandmade(src: string, shuttle: string, projects: Project[]): ImportResult {
  const byMacro = new Map(projects.map((p) => [p.macro, p]));
  const entries: Entry[] = [];
  const needsScript: ImportResult['needsScript'] = [];
  const missing: string[] = [];
  for (const h of parseVgaCycle(src)) {
    const p = byMacro.get(h.macro);
    if (!p) {
      missing.push(h.macro);
      continue;
    }
    if (h.player) needsScript.push({ index: entries.length, macro: h.macro, player: h.player });
    entries.push({
      address: p.address,
      subtile: p.subtile,
      duration_ms: DEFAULT_DURATION_MS,
      clock_hz: p.clock_hz || VGA_CLOCK_HZ,
      ui_in: h.ui_in,
      steps: [],
    });
  }
  return { file: { version: 1, shuttle, projects: entries }, needsScript, missing };
}
