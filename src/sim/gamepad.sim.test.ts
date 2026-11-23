// SPDX-License-Identifier: Apache-2.0
// The simulator's emulated Gamepad Pmod, read by the real decoder: gamepad_pmod.v as the 2048
// game includes it (test/fixtures/sim), compiled with the preview's Verilator engine and run
// by VgaSim with an entry's gamepad steps, which drives ui_in[6:4] level by level with the
// board's timing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Step } from '~/lib/demoFile';
import { STEP_RESET_MS } from '~/lib/stepSchedule';
import { GAMEPAD_BUTTONS, type GamepadButton } from '~/lib/gamepad';
import { type HDLModuleWASM, instantiate, verilate } from './verilate';
import { VgaSim } from './vgaSim';

const FIX = path.resolve(__dirname, '../../test/fixtures/sim');
const wasm = readFileSync(path.resolve(__dirname, '../vendor/vga-playground/verilator/verilator_bin.wasm'));

let mod: HDLModuleWASM;
beforeAll(async () => {
  const sources = {
    'src/gamepad_pmod.v': readFileSync(path.join(FIX, 'gamepad_pmod.v'), 'utf8'),
    'src/gamepad_probe.v': readFileSync(path.join(FIX, 'gamepad_probe.v'), 'utf8'),
  };
  const v = await verilate('tt_um_gamepad_probe', sources, Object.keys(sources), wasm);
  if (!v.ok) throw new Error(v.reason);
  mod = await instantiate(v.modules, {});
}, 120000);

/** The probe's outputs: the buttons it decodes for the player ui_in[0] picks, and who is present. */
function decoded(m: HDLModuleWASM): { buttons: GamepadButton[]; present: [boolean, boolean] } {
  const uo = m.state.uo_out as number;
  const uio = m.state.uio_out as number;
  const bits = uo | ((uio & 0x0f) << 8);
  return { buttons: GAMEPAD_BUTTONS.filter((_, k) => (bits >> k) & 1), present: [!!(uio & 0x40), !!(uio & 0x80)] };
}

function runTo(sim: VgaSim, ms: number) {
  const clocks = Math.ceil(((ms - sim.simMs()) * sim.clockHz) / 1000);
  if (clocks > 0) sim.run(clocks);
}

const STEPS: Step[] = [
  { gamepad: [{ buttons: ['b', 'start', 'up', 'a', 'r'] }, { buttons: ['left', 'x'] }] },
  { wait_ms: 2 },
  { set: 1 }, // show player 2
  { wait_ms: 2 },
  { gamepad: [{ buttons: ['select'] }] },
  { wait_ms: 2 },
  { set: 0 },
  { wait_ms: 2 },
  { gamepad: [] },
  { wait_ms: 2 },
];

describe('the gamepad_pmod Verilog decodes the simulated Pmod', () => {
  for (const clockHz of [25_175_000, 1_000_000]) {
    it(`at ${clockHz} Hz`, () => {
      const sim = new VgaSim(mod, { ui_in: 0, steps: STEPS }, clockHz);
      // before the first report has been sent: no controllers
      expect(decoded(mod)).toEqual({ buttons: [], present: [false, false] });
      runTo(sim, 1.9);
      expect(decoded(mod)).toEqual({ buttons: ['b', 'start', 'up', 'a', 'r'], present: [true, true] });
      runTo(sim, 3.9);
      expect(decoded(mod)).toEqual({ buttons: ['left', 'x'], present: [true, true] });
      runTo(sim, 5.9);
      expect(decoded(mod)).toEqual({ buttons: [], present: [true, false] });
      runTo(sim, 7.9);
      expect(decoded(mod)).toEqual({ buttons: ['select'], present: [true, false] });
      runTo(sim, 9.9);
      expect(decoded(mod)).toEqual({ buttons: [], present: [false, false] });
      // the pass ends at 10 ms: 2 ms in reset, then the held (empty) report again and the
      // first step's, about 1 ms each; 2.9 ms into the pass, player 2 is shown
      runTo(sim, 14.9);
      expect(decoded(mod)).toEqual({ buttons: ['left', 'x'], present: [true, true] });
    }, 120000);
  }

  // The board resends the held report after each end-of-pass reset. Here the first step is a
  // wait, so just after the reset nothing but that resend can make the decoder see 'a'.
  it('resends the held report after the reset', () => {
    const steps: Step[] = [{ wait_ms: 2 }, { gamepad: [{ buttons: ['a'] }] }, { wait_ms: 2 }];
    const sim = new VgaSim(mod, { ui_in: 0, steps }, 1_000_000);
    runTo(sim, 1.9);
    expect(decoded(mod)).toEqual({ buttons: [], present: [false, false] });
    runTo(sim, 3.9);
    expect(decoded(mod)).toEqual({ buttons: ['a'], present: [true, false] });
    // the pass ends at 4 ms and the design is held in reset for STEP_RESET_MS; then the
    // resend (about 1 ms), while step 0 (the wait) runs
    runTo(sim, 4 + STEP_RESET_MS + 1.5);
    expect(decoded(mod)).toEqual({ buttons: ['a'], present: [true, false] });
  }, 120000);
});
