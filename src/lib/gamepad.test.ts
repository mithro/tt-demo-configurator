// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { stubTtboard } from '~/testing/stubTtboard';
import { decodeGamepad, GAMEPAD_BUTTONS, type GamepadController, gamepadLevels, gamepadWord, inButtonOrder, PAD_CLOCK, PAD_DATA, PAD_LATCH } from './gamepad';
import { loadDemoModule } from './live';
import { RawRepl } from './rawRepl';

const CASES: GamepadController[][] = [
  [],
  [{ buttons: [] }],
  [{ buttons: ['b'] }],
  [{ buttons: ['start', 'r'] }],
  [{ buttons: ['b', 'start', 'up', 'a', 'r'] }, { buttons: ['left', 'x'] }],
  [{ buttons: [] }, { buttons: [] }],
  [{ buttons: [...GAMEPAD_BUTTONS.slice(0, 11)] }],
  [{ buttons: [...GAMEPAD_BUTTONS.slice(1)] }, { buttons: ['select'] }],
];

const rising = (vals: number[], bit: number) => vals.filter((v, i) => v & bit && !((i ? vals[i - 1] : 0) & bit)).length;

describe('the report', () => {
  it('puts player 1 in the last 12 bits and fills empty sockets with 1s', () => {
    expect(gamepadWord([])).toBe(0xffffff);
    expect(gamepadWord([{ buttons: [] }])).toBe(0x000fff);
    expect(gamepadWord([{ buttons: ['b'] }])).toBe(0x001fff);
    expect(gamepadWord([{ buttons: ['start', 'r'] }])).toBe((((1 << 3) | (1 << 11)) << 12) | 0xfff);
    expect(gamepadWord([{ buttons: ['a'] }, { buttons: ['left'] }])).toBe(((1 << 8) << 12) | (1 << 6));
  });

  it('sends 24 clocks and one latch, changes data only while the clock is low, and ends idle', () => {
    for (const c of CASES) {
      const lv = gamepadLevels(gamepadWord(c));
      expect(rising(lv, PAD_CLOCK)).toBe(24);
      expect(rising(lv, PAD_LATCH)).toBe(1);
      lv.forEach((v, i) => {
        const before = i ? lv[i - 1] : 0;
        expect(v).not.toBe(before);
        expect(v & ~0x70).toBe(0);
        if ((v ^ before) & PAD_DATA) expect((v | before) & PAD_CLOCK).toBe(0);
      });
      expect(lv[lv.length - 1]).toBe(0);
    }
  });

  it('decodes as the buttons sent', () => {
    for (const c of CASES) {
      const want = [c[0]?.buttons ?? null, c[1]?.buttons ?? null];
      expect(decodeGamepad(gamepadLevels(gamepadWord(c)))).toEqual([want]);
    }
  });

  it('orders buttons as the Pmod sends them', () => {
    expect(inButtonOrder(['r', 'a', 'b', 'a'])).toEqual(['b', 'a', 'r']);
  });
});

describe('the board sends the same levels (pinned demo.py in CPython)', () => {
  let board: PythonBoard;
  let repl: RawRepl;
  beforeAll(async () => {
    board = startPythonBoard();
    repl = new RawRepl(board.transport, async () => undefined);
    await repl.enter();
    await repl.check(stubTtboard({ index: { projects: [] } }));
    await loadDemoModule(repl, { firmware: 'stock', mcu: 'RP2350', demoPy: null });
  });
  afterAll(() => board.stop());

  it('gamepad_word and gamepad_levels agree with the app', async () => {
    const out = await repl.check(
      `import json\nprint(json.dumps([[_tdc_demo['gamepad_word'](c), _tdc_demo['gamepad_levels'](_tdc_demo['gamepad_word'](c))] for c in json.loads(${JSON.stringify(JSON.stringify(CASES))})]))\n`,
    );
    expect(JSON.parse(out)).toEqual(CASES.map((c) => [gamepadWord(c), gamepadLevels(gamepadWord(c))]));
  });

  it("StepPlayer writes those levels over the last set's other bits", async () => {
    const steps = [{ set: 0x81 }, { gamepad: [{ buttons: ['up', 'a'] }] }, { wait_ms: 100 }];
    const out = await repl.check(
      'import json\n' +
        'class _P:\n def __init__(s): s.w = []\n @property\n def value(s): return s.w[-1]\n @value.setter\n def value(s, v): s.w.append(v)\n' +
        'class _T:\n def init(s, **k): pass\n def deinit(s): pass\n' +
        '_T.ONE_SHOT = 0\n' +
        'class _TT:\n def __init__(s): s.ui_in = _P()\n def reset_project(s, r): pass\n' +
        `_tt = _TT()\n_p = _tdc_demo['StepPlayer'](_tt, json.loads(${JSON.stringify(JSON.stringify(steps))}), timer_class=_T, sleep_ms=lambda ms: None, ui_in=1)\n` +
        '_p.start()\nprint(json.dumps(_tt.ui_in.w))\n',
    );
    const writes: number[] = JSON.parse(out);
    const lv = gamepadLevels(gamepadWord([{ buttons: ['up', 'a'] }]));
    expect(writes).toEqual([0x81, ...lv.map((v) => 0x81 | v)]);
    expect(decodeGamepad(writes)).toEqual([[['up', 'a'], null]]);
  });
});
