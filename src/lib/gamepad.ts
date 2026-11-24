// SPDX-License-Identifier: Apache-2.0
// The Gamepad Pmod (https://github.com/psychogenic/gamepad-pmod) as the board emulates it
// for "gamepad" steps: the same encoding as gamepad_word() and gamepad_levels() in the
// firmware's demo.py (src/data/demo.py), which a test checks level for level.
//
// The Pmod sends 24 bits on ui_in[6] (data), LSB first: each bit is put on data, then the
// clock (ui_in[5]) goes high and low; then the latch (ui_in[4]) pulses and the design takes
// the bits. An empty controller socket sends twelve 1s; player 1 (the controller a design's
// gamepad_pmod_single reads, index 0 of gamepad_pmod_dual) is sent last.

/** The buttons, in the order the Pmod sends them, named as in the Verilog module. */
export const GAMEPAD_BUTTONS = ['b', 'y', 'select', 'start', 'up', 'down', 'left', 'right', 'a', 'x', 'l', 'r'] as const;
export type GamepadButton = (typeof GAMEPAD_BUTTONS)[number];

/** One controller plugged into the Pmod, and the buttons it is holding (in GAMEPAD_BUTTONS order). */
export interface GamepadController {
  buttons: GamepadButton[];
}

/** ui_in bits the gamepad drives. */
export const GAMEPAD_PINS = 0x70;
export const PAD_LATCH = 0x10;
export const PAD_CLOCK = 0x20;
export const PAD_DATA = 0x40;
const NO_CONTROLLER = 0xfff;

/** The labels people know the buttons by. */
export const BUTTON_LABEL: Record<GamepadButton, string> = {
  b: 'B',
  y: 'Y',
  select: 'Select',
  start: 'Start',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  a: 'A',
  x: 'X',
  l: 'L',
  r: 'R',
};

export const isButton = (v: unknown): v is GamepadButton => typeof v === 'string' && (GAMEPAD_BUTTONS as readonly string[]).includes(v);

/** The buttons in the order the format wants them, each once. */
export function inButtonOrder(buttons: Iterable<GamepadButton>): GamepadButton[] {
  const set = new Set(buttons);
  return GAMEPAD_BUTTONS.filter((b) => set.has(b));
}

/** The 24 bits sent for these controllers, bit 0 first. */
export function gamepadWord(controllers: GamepadController[]): number {
  const masks = controllers.map((c) => c.buttons.reduce((m, b) => m | (1 << GAMEPAD_BUTTONS.indexOf(b)), 0));
  while (masks.length < 2) masks.push(NO_CONTROLLER);
  return (masks[1] | (masks[0] << 12)) >>> 0;
}

/**
 * The latch/clock/data levels (ui_in bits 4..6) of one report, in the order the board writes
 * them: data, clock high, clock low for each bit; a latch pulse; then all low. A level equal
 * to the one before it is left out, so the list starts and ends from idle (0).
 */
export function gamepadLevels(word: number): number[] {
  const seq: number[] = [];
  let d = 0;
  for (let i = 0; i < 24; i++) {
    d = (word >>> i) & 1 ? PAD_DATA : 0;
    seq.push(d, d | PAD_CLOCK, d);
  }
  seq.push(d | PAD_LATCH, d, 0);
  const out: number[] = [];
  let last = 0;
  for (const v of seq) {
    if (v !== last) out.push(v);
    last = v;
  }
  return out;
}

/** What a design decodes for each player: the buttons held, or null for no controller. */
export type Decoded = [GamepadButton[] | null, GamepadButton[] | null];

/**
 * What the gamepad_pmod_driver and gamepad_pmod_decoder Verilog (which most designs include)
 * make of a series of ui_in values, ignoring its synchronizer: data is shifted in on each
 * rising clock edge, and each rising latch edge gives a report. For tests and the hardware
 * check.
 */
export function decodeGamepad(values: number[], start = 0): Decoded[] {
  let shift = 0xffffff;
  let prev = start;
  const reports: Decoded[] = [];
  const player = (reg: number) => (reg === NO_CONTROLLER ? null : GAMEPAD_BUTTONS.filter((_, k) => (reg >> (11 - k)) & 1));
  for (const v of values) {
    if (v & PAD_CLOCK && !(prev & PAD_CLOCK)) shift = ((shift << 1) | ((v >> 6) & 1)) & 0xffffff;
    if (v & PAD_LATCH && !(prev & PAD_LATCH)) reports.push([player(shift & 0xfff), player(shift >>> 12)]);
    prev = v;
  }
  return reports;
}
