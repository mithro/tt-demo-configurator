// SPDX-License-Identifier: Apache-2.0
// The live functions run against the CPython fake board, which executes the real pinned
// demo.py: so this is also a third check that the board's validate() and the app's agree.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { stubTtboard } from '~/testing/stubTtboard';
import { boardValidate, playOne, runFromRam, stopDemo } from './live';
import { RawRepl } from './rawRepl';

const FIX = path.resolve(__dirname, '../../test/fixtures');
const index = JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const stock = { firmware: 'stock' as const };

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
  for (const name of readdirSync(path.join(FIX, 'bad')).filter((n) => !n.endsWith('.errors.json'))) {
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
