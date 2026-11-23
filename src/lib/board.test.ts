// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { stubTtboard } from '~/testing/stubTtboard';
import { detect, dieName, HELPER_MARKER, parseDetect, readFile, removeFile, unsupportedReason, writeFile } from './board';
import { planInstallHelper, planResetToStock } from './helper';
import { RawRepl } from './rawRepl';
import { sha256Hex } from './sha256';

let board: PythonBoard;
let repl: RawRepl;
beforeAll(async () => {
  board = startPythonBoard();
  repl = new RawRepl(board.transport, async () => undefined);
  await repl.enter();
  await repl.check(stubTtboard());
});
afterAll(() => board.stop());

describe('file transfer', () => {
  it('round-trips a file larger than one chunk, byte for byte', async () => {
    const text = Array.from({ length: 900 }, (_, i) => `line ${i} — ü ✓ "quote" \\ ${'x'.repeat(i % 50)}`).join('\n');
    await writeFile(repl, '/big.txt', text);
    expect(await readFile(repl, '/big.txt')).toBe(text);
    expect(await readFile(repl, '/big.txt.tmp')).toBeNull();
  });
  it('overwrites, reads empty files, and reports missing ones as null', async () => {
    await writeFile(repl, '/a.txt', 'one');
    await writeFile(repl, '/a.txt', '');
    expect(await readFile(repl, '/a.txt')).toBe('');
    await removeFile(repl, '/a.txt');
    await removeFile(repl, '/a.txt');
    expect(await readFile(repl, '/a.txt')).toBeNull();
  });
});

describe('detect', () => {
  it('sees a stock board', async () => {
    await writeFile(repl, '/main.py', 'print("stock")\n');
    await writeFile(repl, '/config.ini', '[DEFAULT]\nlog_level = INFO\n');
    const info = await detect(repl);
    expect(info).toMatchObject({ firmware: 'stock', sdk: '3.1.1', mcu: 'RP2350', shuttle: 'ttsky25a', projects: 237, demoSetting: false, isFpga: false });
    expect(info.main).toBe('print("stock")\n');
    expect(info.configIni).toBe('[DEFAULT]\nlog_level = INFO\n');
    expect(info.rom).toEqual({ shuttle: 'ttsky25a', repo: 'TinyTapeout/x', commit: 'abcd1234' });
    expect(info.demoJson).toBeNull();
  });
  it('reads the ui_in DIP switches, and drives the pins again when they are off', async () => {
    await repl.check('from ttboard.demoboard import DemoBoard\ntt = DemoBoard.get()\n');
    expect((await detect(repl)).dipOn).toEqual([]);
    expect((await repl.check('print(tt.pins.ui_in0.is_input)\n')).trim()).toBe('False');
    await repl.check('tt.pins.ui_in0.switch = 1\ntt.pins.ui_in5.switch = 1\n');
    const info = await detect(repl);
    expect(info.dipOn).toEqual([0, 5]);
    expect(info.mode).toBe('ASIC_RP_CONTROL');
    // a pin whose switch is on is left undriven, as the SDK leaves it
    expect((await repl.check('print(tt.pins.ui_in0.is_input, tt.pins.ui_in1.is_input)\n')).trim()).toBe('True False');
    await repl.check('tt.pins.ui_in0.switch = 0\ntt.pins.ui_in5.switch = 0\n');
    expect((await detect(repl)).dipOn).toEqual([]);
  });
  it('sees the helper, demo = yes and /demo.json', async () => {
    await writeFile(repl, '/main.py', `${HELPER_MARKER}\nexec(open('/main_stock.py').read())\n`);
    await writeFile(repl, '/demo.py', '# demo\n');
    await writeFile(repl, '/demo.json', '{"version": 1}');
    await writeFile(repl, '/config.ini', '[DEFAULT]\ndemo = yes\n');
    expect(await detect(repl)).toMatchObject({ firmware: 'helper', demoSetting: true, demoJson: '{"version": 1}', demoPy: { sha256: sha256Hex('# demo\n') } });
  });
  it('still reports the board when /demo.py cannot be hashed, and keeps it a helper board', async () => {
    await writeFile(repl, '/main_stock.py', 'print("stock")\n');
    await repl.check(
      "import hashlib\n_real_sha256 = hashlib.sha256\nclass _NoMem:\n def update(self, c): raise MemoryError('memory allocation failed')\nhashlib.sha256 = lambda: _NoMem()\n",
    );
    let info;
    try {
      info = await detect(repl);
    } finally {
      await repl.check('hashlib.sha256 = _real_sha256\n');
    }
    expect(info).toMatchObject({ firmware: 'helper', demoPy: { sha256: null }, demoSetting: true });
    expect(info.errors).toContain("could not hash /demo.py: MemoryError('memory allocation failed')");
    // not mistaken for a board without the helper: install rewrites it, reset removes it
    expect(planInstallHelper(info).map((o) => `${o.op} ${o.path}`)).toContain('write /demo.py');
    expect(planResetToStock(info).map((o) => `${o.op} ${o.path}`)).toContain('remove /demo.py');
    await removeFile(repl, '/main_stock.py');
  });
  it('sees a hand-made Shenzhen board', async () => {
    await removeFile(repl, '/demo.py');
    await writeFile(repl, '/vga_cycle.py', 'VGA_DESIGNS = []\n');
    await writeFile(repl, '/main.py', 'print(1)\nimport vga_cycle\nvga_cycle.run(tt)\n');
    expect((await detect(repl)).firmware).toBe('handmade');
  });
  it('sees the demo-mode firmware', async () => {
    await repl.check("import sys, types\nsys.modules['ttboard.demo'] = types.ModuleType('ttboard.demo')\n");
    expect((await detect(repl)).firmware).toBe('custom');
  });
});

describe('dieName', () => {
  const gf = (commit: string) => ({ shuttle: 'ttgf0p2', rom: { shuttle: 'ttgf0p2', repo: 'TinyTapeout/tinytapeout-gf-0p2', commit } });
  it('names the two GF 0p2 dies by ROM commit', () => {
    expect(dieName(gf('7416232b'))).toBe('TTP2');
    expect(dieName(gf('FF701BAA'))).toBe('TTPG (power-gated)');
  });
  it('gives no name for other commits, other shuttles, or an unreadable ROM', () => {
    expect(dieName(gf('12345678'))).toBeNull();
    expect(dieName(gf(''))).toBeNull();
    expect(dieName({ shuttle: 'ttsky25a', rom: { commit: '7416232b' } })).toBeNull();
    expect(dieName({ shuttle: 'ttgf0p2', rom: 'unknown' })).toBeNull();
    expect(dieName({ shuttle: 'ttgf0p2', rom: null })).toBeNull();
  });
});

describe('unsupportedReason', () => {
  const info = (machine: string, sdk: string | null = '3.1.1', shuttle = 'tt07') =>
    parseDetect('DETECT:' + JSON.stringify({ machine, shuttle, sdk, projects: 10 }));
  const etr = 'Tiny Tapeout Demoboard ETR with RP2350';
  const pico = 'Raspberry Pi Pico with RP2040';
  it('accepts RP2350 boards on SDK 3.x', () => {
    expect(unsupportedReason(info(etr))).toBeNull();
    expect(unsupportedReason(info(etr, '3.0.0'))).toBeNull();
  });
  it('accepts RP2040 boards on SDK 2.x', () => {
    for (const v of ['2.0.0', '2.0.4']) expect(unsupportedReason(info(pico, v)), v).toBeNull();
    expect(info(pico, '2.0.4').mcu).toBe('RP2040');
  });
  it('lets an unnumbered build through (from source, or no release file)', () => {
    expect(unsupportedReason(info(pico, '0.0.0'))).toBeNull();
    expect(unsupportedReason(info(pico, null))).toBeNull();
  });
  it('points an old RP2040 SDK at the RP2040 release, never the RP2350 one', () => {
    const why = unsupportedReason(info(pico, '1.2.2'))!;
    expect(why).toContain('SDK 1.2.2');
    expect(why).toContain('tt-demo-rp2040-v2.0.4.uf2');
    expect(why).toContain('/releases/tag/v2.0.4');
    expect(why).not.toContain('rp2350');
    expect(unsupportedReason(info(etr, '2.0.4'))).toContain('tt-demo-rp2350-v3.1.1.uf2');
  });
  it('explains a board it does not know', () => {
    const why = unsupportedReason(info('ESP32 module'));
    expect(why).toContain('This board’s microcontroller (ESP32 module) isn’t one the configurator knows.');
    expect(unsupportedReason(info(''))).toContain('(it didn’t say which)');
    expect(why).toContain('still build, preview and download');
  });
  it('refuses the FPGA board', () => {
    expect(unsupportedReason(info(etr, '3.1.1', 'FPGA'))).toContain('FPGA breakout');
  });
});

describe('detect on an RP2040 board (SDK 2.x stub)', () => {
  let b2: PythonBoard;
  let r2: RawRepl;
  beforeAll(async () => {
    b2 = startPythonBoard();
    r2 = new RawRepl(b2.transport, async () => undefined);
    await r2.enter();
    await r2.check(stubTtboard({ mcu: 'RP2040' }));
  });
  afterAll(() => b2.stop());
  it('sees the chip, the SDK, the mode and the DIP switches', async () => {
    await writeFile(r2, '/main.py', 'print("stock 2")\n');
    const info = await detect(r2);
    expect(info).toMatchObject({ mcu: 'RP2040', sdk: '2.0.4', shuttle: 'tt07', firmware: 'stock', mode: 'ASIC_RP_CONTROL', dipOn: [], demoPy: null });
    expect(unsupportedReason(info)).toBeNull();
    await r2.check('from ttboard.demoboard import DemoBoard\nDemoBoard.get().pins.ui_in7.switch = 1\n');
    expect((await detect(r2)).dipOn).toEqual([7]);
  });
});
