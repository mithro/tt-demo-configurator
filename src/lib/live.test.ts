// SPDX-License-Identifier: Apache-2.0
// The live functions run against the CPython fake board, which executes the real pinned
// demo.py: so this is also a third check that the board's validate() and the app's agree.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { stubTtboard } from '~/testing/stubTtboard';
import { HELPER_DEMO_PY } from './helper';
import { boardValidate, LiveBoard, playOne, runFromRam, sourcePieces, stopDemo } from './live';
import { RawRepl } from './rawRepl';

const FIX = path.resolve(__dirname, '../../test/fixtures');
const index = JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const stock: LiveBoard = { firmware: 'stock', mcu: 'RP2350', demoPySha256: null };
const badFixtures = readdirSync(path.join(FIX, 'bad')).filter((n) => !n.endsWith('.errors.json'));

let board: PythonBoard;
let repl: RawRepl;
beforeAll(async () => {
  board = startPythonBoard();
  repl = new RawRepl(board.transport, async () => undefined);
  await repl.enter();
  await repl.check(stubTtboard({ index }));
});
afterAll(() => board.stop());

describe('boardValidate (pinned demo.py, sent to RAM)', () => {
  for (const name of badFixtures) {
    it(`gives the firmware's errors for bad/${name}`, async () => {
      const text = readFileSync(path.join(FIX, 'bad', name), 'utf8');
      const expected = JSON.parse(readFileSync(path.join(FIX, 'bad', name.replace(/\.json$/, '.errors.json')), 'utf8'));
      expect(await boardValidate(repl, stock, text)).toEqual(expected);
    });
  }
  it('reports bad JSON', async () => {
    expect((await boardValidate(repl, stock, '{'))[0]).toMatch(/^not valid JSON/);
  });
});

describe('runFromRam', () => {
  it('starts a valid sequence as tt.demo and applies the first entry', async () => {
    const file = JSON.parse(readFileSync(path.join(FIX, 'good', 'steps-and-subtile.json'), 'utf8'));
    expect(await runFromRam(repl, stock, file)).toEqual([]);
    const out = await repl.check('print(tt.demo.running, tt.shuttle.enabled.name, tt.clock)\n');
    expect(out.trim()).toBe('True tt_um_RoyTr16 25000000');
    await stopDemo(repl);
    expect((await repl.check('print(tt.demo.running)\n')).trim()).toBe('False');
  });
  it('does not start an invalid one', async () => {
    const errs = await playOne(repl, stock, 'ttsky25a', { address: 999, subtile: 0, duration_ms: 1, clock_hz: 0, ui_in: 0, steps: [] });
    expect(errs).toEqual(['project 0: no project at address 999 on ttsky25a']);
  });
});

describe('sourcePieces', () => {
  it('cuts each helper before its top-level defs and classes, losing nothing', () => {
    for (const src of Object.values(HELPER_DEMO_PY)) {
      const pieces = sourcePieces(src);
      expect(pieces.join('')).toBe(src);
      expect(pieces.length).toBeGreaterThan(10);
      for (const p of pieces.slice(1)) expect(p).toMatch(/^(def|class) /);
      // the biggest piece is what the board must hold and compile at once
      expect(Math.max(...pieces.map((p) => p.length))).toBeLessThan(8000);
    }
  });
});

describe('an RP2040 board on SDK 2.x (stub)', () => {
  const rp2040: LiveBoard = { firmware: 'stock', mcu: 'RP2040', demoPySha256: null };
  let b2: PythonBoard;
  let r2: RawRepl;
  beforeAll(async () => {
    b2 = startPythonBoard();
    r2 = new RawRepl(b2.transport, async () => undefined);
    await r2.enter();
    await r2.check(stubTtboard({ mcu: 'RP2040', shuttle: 'ttsky25a', index }));
  });
  afterAll(() => b2.stop());
  it("can't run the SDK 3.x helper (the reason there is a port)", async () => {
    await expect(r2.check('from ttboard.util.platform import IsRP2\n')).rejects.toThrow(/IsRP2/);
  });
  for (const name of badFixtures) {
    it(`gives the same errors for bad/${name}`, async () => {
      const text = readFileSync(path.join(FIX, 'bad', name), 'utf8');
      const expected = JSON.parse(readFileSync(path.join(FIX, 'bad', name.replace(/\.json$/, '.errors.json')), 'utf8'));
      expect(await boardValidate(r2, rp2040, text)).toEqual(expected);
    });
  }
  it('runs a sequence from RAM with the SDK 2.x helper', async () => {
    const file = JSON.parse(readFileSync(path.join(FIX, 'good', 'minimal.json'), 'utf8'));
    expect(await runFromRam(r2, rp2040, file)).toEqual([]);
    expect((await r2.check("print(_tdc_demo['IsRP2040'], 'boot_button_held' in _tdc_demo)\n")).trim()).toBe('False False');
    expect((await r2.check('print(tt.demo.running)\n')).trim()).toBe('True');
    await stopDemo(r2);
  });
});
