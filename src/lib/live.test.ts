// SPDX-License-Identifier: Apache-2.0
// The live functions run against the CPython fake board, which executes the real pinned
// demo.py: so this is also a third check that the board's validate() and the app's agree.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { FPGA4_BITSTREAMS } from '~/testing/fpga4';
import { stubTtboard } from '~/testing/stubTtboard';
import { HELPER_DEMO_PY, WRAPPER_MAIN } from './helper';
import { boardValidate, LiveBoard, playOne, runFromRam, sourcePieces, stopDemo } from './live';
import { removeFile, writeFile } from './board';
import { RawRepl } from './rawRepl';
import { sha256Hex } from './sha256';

const FIX = path.resolve(__dirname, '../../test/fixtures');
const index = JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const stock: LiveBoard = { firmware: 'stock', mcu: 'RP2350', demoPy: null };
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

describe('loading the helper into RAM', () => {
  let b3: PythonBoard;
  let r3: RawRepl;
  beforeAll(async () => {
    b3 = startPythonBoard();
    r3 = new RawRepl(b3.transport, async () => undefined);
    await r3.enter();
    await r3.check(stubTtboard({ index }));
  });
  afterAll(() => b3.stop());
  it('leaves no half-built module when a piece fails, so the next try starts over', async () => {
    // the third piece runs out of memory, as it could on an RP2040
    await r3.check(
      "import builtins\n_calls = [0]\ndef exec(src, g=None):\n _calls[0] += 1\n if _calls[0] == 3: raise MemoryError('memory allocation failed')\n return builtins.exec(src, g)\n",
    );
    await expect(boardValidate(r3, stock, '{}')).rejects.toThrow(/MemoryError/);
    expect((await r3.check("print('_tdc_demo' in globals(), '_tdc_part' in globals(), '_tdc_src' in globals())\n")).trim()).toBe(
      'False False False',
    );
    await r3.check('del exec\n');
    const text = readFileSync(path.join(FIX, 'bad', 'lookup.json'), 'utf8');
    expect(await boardValidate(r3, stock, text)).toEqual(JSON.parse(readFileSync(path.join(FIX, 'bad', 'lookup.errors.json'), 'utf8')));
  });
  it('uses the current /demo.py on a helper board, not an older one the boot wrapper imported', async () => {
    // booted with an old helper...
    await writeFile(r3, '/demo.py', "def validate(conf, run, shuttle=None):\n    return ([], ['the OLD helper'])\n");
    await r3.check("for _n in ('_tdc_demo', '_tdc_demo_sha256'):\n globals().pop(_n, None)\nimport demo\n");
    // ...then "Make permanent" wrote the current one, and the board was not rebooted
    await writeFile(r3, '/demo.py', HELPER_DEMO_PY.RP2350);
    const helper: LiveBoard = { firmware: 'helper', mcu: 'RP2350', demoPy: { sha256: sha256Hex(HELPER_DEMO_PY.RP2350) } };
    const text = readFileSync(path.join(FIX, 'bad', 'lookup.json'), 'utf8');
    const expected = JSON.parse(readFileSync(path.join(FIX, 'bad', 'lookup.errors.json'), 'utf8'));
    expect(await boardValidate(r3, helper, text)).toEqual(expected);
    // and RAM code from an earlier, different helper is not reused either
    await r3.check("_tdc_demo_sha256 = 'something else'\n_tdc_demo['validate'] = lambda *a: ([], ['stale'])\n");
    expect(await boardValidate(r3, helper, text)).toEqual(expected);
    await removeFile(r3, '/demo.py');
  });
});

describe('sourcePieces', () => {
  it('cuts each helper before its top-level defs and classes, losing nothing', () => {
    for (const src of Object.values(HELPER_DEMO_PY)) {
      const pieces = sourcePieces(src);
      expect(pieces.join('')).toBe(src);
      expect(pieces.length).toBeGreaterThan(10);
      for (const p of pieces.slice(1)) expect(p).toMatch(/^(def|class|@)/);
      // the biggest piece is what the board must hold and compile at once
      expect(Math.max(...pieces.map((p) => p.length))).toBeLessThan(8000);
      expect(compileEach(pieces)).toEqual(pieces.map(() => 'ok'));
    }
  });
  it('keeps decorators with their def and never cuts a string', () => {
    const src = [
      "'''A module.",
      'def this_is_text_not_code():',
      "'''",
      'import json',
      '@staticmethod',
      '@other',
      'def f():',
      '    """',
      'class NotAClass:',
      '    """',
      '    return 1',
      'class C:',
      '    pass',
    ].join('\n');
    const pieces = sourcePieces(src);
    expect(pieces.join('')).toBe(src);
    expect(pieces.map((p) => p.split('\n')[0])).toEqual(["'''A module.", '@staticmethod', 'class C:']);
    expect(compileEach(pieces)).toEqual(['ok', 'ok', 'ok']);
  });
});

/** CPython's compile() of each piece on its own: "ok" or the SyntaxError. */
function compileEach(pieces: string[]): string[] {
  const code =
    'import json, sys\nout = []\nfor p in json.load(sys.stdin):\n    try:\n        compile(p, "piece", "exec")\n        out.append("ok")\n' +
    '    except SyntaxError as e:\n        out.append(repr(e))\nprint(json.dumps(out))\n';
  return JSON.parse(execFileSync('uv', ['run', '--no-project', 'python', '-I', '-c', code], { input: JSON.stringify(pieces), encoding: 'utf8' }));
}

describe('an RP2040 board on SDK 2.x (stub)', () => {
  const rp2040: LiveBoard = { firmware: 'stock', mcu: 'RP2040', demoPy: null };
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

describe('the FPGA board (stub of SDK 3.1.0 with its FPGA breakout)', () => {
  const fpga: LiveBoard = { firmware: 'stock', mcu: 'RP2350', demoPy: null };
  const counter = FPGA4_BITSTREAMS.indexOf('tt_um_counter_7seg');
  const entry = { address: counter, subtile: 0, duration_ms: 15000, clock_hz: 10, ui_in: 0x80, steps: [] };
  const file = { version: 1 as const, shuttle: 'FPGA', projects: [entry] };
  let bf: PythonBoard;
  let rf: RawRepl;
  beforeAll(async () => {
    bf = startPythonBoard();
    rf = new RawRepl(bf.transport, async () => undefined);
    await rf.enter();
    await rf.check(stubTtboard({ fpga: FPGA4_BITSTREAMS }));
  });
  afterAll(() => bf.stop());
  it('looks designs up by their bitstream address', async () => {
    expect(await boardValidate(rf, fpga, JSON.stringify(file))).toEqual([]);
    const bad = { ...file, projects: [{ ...entry, address: FPGA4_BITSTREAMS.length }] };
    expect(await boardValidate(rf, fpga, JSON.stringify(bad))).toEqual(['project 0: no project at address 8 on FPGA']);
  });
  it('drives ui_in from RAM: it switches the board out of the manual-inputs mode its SDK forces', async () => {
    expect((await rf.check('from ttboard.demoboard import DemoBoard\nprint(DemoBoard.get().mode_str)\n')).trim()).toBe('ASIC_MANUAL_INPUTS');
    expect(await runFromRam(rf, fpga, file)).toEqual([]);
    const out = await rf.check('print(tt.demo.running, tt.shuttle.enabled.name, tt.mode_str, int(tt.ui_in.value), tt.clock)\n');
    expect(out.trim()).toBe('True tt_um_counter_7seg ASIC_RP_CONTROL 128 10');
    await stopDemo(rf);
  });
  it('drives ui_in at boot through the helper, only when demo mode is on', async () => {
    const boot = async (ini: string) => {
      await rf.check(
        "import sys\nsys.modules.pop('demo', None)\nfrom ttboard.demoboard import DemoBoard\nfrom ttboard.mode import RPMode\n" +
          'tt = DemoBoard.get()\ntt.mode = RPMode.ASIC_MANUAL_INPUTS\ntt.demo = None\n',
      );
      await writeFile(rf, '/config.ini', ini);
      await rf.check("exec(open('/main.py').read())\n");
      return (await rf.check('print(bool(tt.demo and tt.demo.running), tt.mode_str, int(tt.ui_in.value))\n')).trim();
    };
    await writeFile(rf, '/main_stock.py', 'from ttboard.demoboard import DemoBoard\ntt = DemoBoard.get()\n');
    await writeFile(rf, '/main.py', WRAPPER_MAIN);
    await writeFile(rf, '/demo.py', HELPER_DEMO_PY.RP2350);
    await writeFile(rf, '/demo.json', JSON.stringify(file));
    expect(await boot('[DEFAULT]\ndemo = yes\n')).toBe('True ASIC_RP_CONTROL 128');
    await stopDemo(rf);
    expect(await boot('[DEFAULT]\ndemo = no\n')).toBe('False ASIC_MANUAL_INPUTS 0');
  });
});
