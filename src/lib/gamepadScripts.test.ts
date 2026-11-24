// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { validateDemo } from './demoFile';
import { GAMEPAD_SCRIPTS, padBefore, padPress, withPressed } from './gamepadScripts';

describe('gamepad step helpers', () => {
  it('presses on top of what is held, in button order, plugging in a player if needed', () => {
    expect(withPressed([{ buttons: ['r'] }], 'b')).toEqual([{ buttons: ['b', 'r'] }]);
    expect(withPressed([], 'a', 1)).toEqual([{ buttons: [] }, { buttons: ['a'] }]);
    expect(withPressed([{ buttons: ['a'] }], 'a')).toEqual([{ buttons: ['a'] }]);
  });
  it('makes a press of four steps', () => {
    expect(padPress([{ buttons: [] }], 'start', 100, 200)).toEqual([
      { gamepad: [{ buttons: ['start'] }] },
      { wait_ms: 100 },
      { gamepad: [{ buttons: [] }] },
      { wait_ms: 200 },
    ]);
  });
  it('finds the controllers the earlier steps leave', () => {
    const steps = [{ set: 1 }, { gamepad: [{ buttons: ['a' as const] }] }, { wait_ms: 1 }];
    expect(padBefore(steps, 1)).toBeNull();
    expect(padBefore(steps, 3)).toEqual([{ buttons: ['a'] }]);
  });
});

describe('example scripts', () => {
  for (const [macro, script] of Object.entries(GAMEPAD_SCRIPTS)) {
    it(`${macro}: valid`, () => {
      const file = { version: 1, shuttle: 'ttsky25a', projects: [{ address: 1, subtile: 0, duration_ms: 30000, clock_hz: 25175000, ui_in: 0, steps: script.steps }] };
      expect(validateDemo(file, 'ttsky25a')).toEqual([]);
    });
  }
});
