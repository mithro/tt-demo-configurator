// SPDX-License-Identifier: Apache-2.0
// Gamepad step helpers for the editor, and example scripts for designs known to read the
// Gamepad Pmod, by macro (the same design on several shuttles shares one).
import type { Step } from './demoFile';
import { type GamepadButton, type GamepadController, inButtonOrder } from './gamepad';

/** One controller, nothing pressed: what a Pmod with a controller plugged in sends at rest. */
export const PAD_IDLE: GamepadController[] = [{ buttons: [] }];

/** `held` with player `player`'s `button` pressed as well (a player not plugged in is added). */
export function withPressed(held: GamepadController[], button: GamepadButton, player = 0): GamepadController[] {
  const pads = held.map((c) => ({ buttons: [...c.buttons] }));
  while (pads.length <= player) pads.push({ buttons: [] });
  pads[player] = { buttons: inButtonOrder([...pads[player].buttons, button]) };
  return pads;
}

/** A press: the button held for holdMs on top of `held`, released, then gapMs. */
export function padPress(held: GamepadController[], button: GamepadButton, holdMs = 100, gapMs = 200, player = 0): Step[] {
  return [{ gamepad: withPressed(held, button, player) }, { wait_ms: holdMs }, { gamepad: held }, { wait_ms: gapMs }];
}

/** The controllers as the steps before step i leave them: null if no gamepad step has run yet. */
export function padBefore(steps: Step[], i: number): GamepadController[] | null {
  for (let j = i - 1; j >= 0; j--) {
    const st = steps[j];
    if ('gamepad' in st) return st.gamepad;
  }
  return null;
}

export interface GamepadScript {
  title: string;
  /** what the script shows, for the editor */
  note: string;
  steps: Step[];
}

const presses = (buttons: GamepadButton[], holdMs: number, gapMs: number) => buttons.flatMap((b) => padPress(PAD_IDLE, b, holdMs, gapMs));

export const GAMEPAD_SCRIPTS: Record<string, GamepadScript> = {
  tt_um_gamepad_pmod_demo: {
    title: 'every button in turn',
    note: 'Plugs in a controller and presses each of the 12 buttons for 300 ms, so each symbol lights up green in turn.',
    steps: [{ gamepad: PAD_IDLE }, { wait_ms: 500 }, ...presses(['b', 'y', 'select', 'start', 'up', 'down', 'left', 'right', 'a', 'x', 'l', 'r'], 300, 200)],
  },
  tt_um_2048_vga_game: {
    title: 'start and play',
    note: 'Waits on the welcome screen, presses Start, makes a round of moves with the d-pad, switches the colour theme with Select and plays on; the reset at the end shows the welcome screen again.',
    steps: [
      { gamepad: PAD_IDLE },
      { wait_ms: 2000 },
      ...padPress(PAD_IDLE, 'start', 100, 600),
      ...presses(['right', 'down', 'left', 'down', 'right', 'down', 'left', 'up'], 100, 500),
      ...padPress(PAD_IDLE, 'select', 100, 600),
      ...presses(['right', 'down', 'left', 'down', 'right', 'down', 'left', 'down'], 100, 500),
      { wait_ms: 1500 },
    ],
  },
};
