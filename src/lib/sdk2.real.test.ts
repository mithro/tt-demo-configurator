// SPDX-License-Identifier: Apache-2.0
// The app's board code against the real SDK 2.x (RP2040 demoboards), booted from its own
// stock main.py and config.ini in the CPython fake board (see src/testing/realSdk2.ts for
// what is faked). Skipped until `uv run --no-project scripts/fetch-sdk2.py` has fetched
// the SDK into tmp/sdk2/.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { bootSdk2, installStockSdk2, sdk2File, sdk2Version } from '~/testing/realSdk2';
import { BoardInfo, detect, unsupportedReason } from './board';
import { HELPER_DEMO_PY, planInstallHelper, planMakePermanent, planResetToStock, planTurnOff, stockMainFor, stockWarnings } from './helper';
import { applyOps, boardValidate, runFromRam, stopDemo } from './live';
import { RawRepl } from './rawRepl';

const FIX = path.resolve(__dirname, '../../test/fixtures');
const index = JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8'));
// every shuttle has the factory test (the stock config.ini's default project and the error display)
const projects = [{ macro: 'tt_um_factory_test', address: 1, danger_level: 'safe', clock_hz: 0 }, ...index.projects];
// the fixtures are written for ttsky25a: the chip ROM says so, the SDK doesn't mind
const ROM = { shuttle: 'ttsky25a', repo: 'TinyTapeout/tinytapeout-07', commit: 'abcd1234' };

describe.skipIf(!sdk2Version)(`the real SDK ${sdk2Version ?? '2.x'} (RP2040)`, () => {
  let board: PythonBoard;
  let repl: RawRepl;
  let info: BoardInfo;
  const reboot = async () => {
    await repl.check(bootSdk2(ROM), 30000);
    info = await detect(repl);
  };
  beforeAll(async () => {
    board = startPythonBoard();
    installStockSdk2(board.root, ROM.shuttle, projects);
    repl = new RawRepl(board.transport, async () => undefined);
    await repl.enter();
    await reboot();
  });
  afterAll(() => board.stop());

  it('boots its stock main.py and is detected as a supported RP2040 board', () => {
    expect(info).toMatchObject({
      mcu: 'RP2040', sdk: sdk2Version, shuttle: 'ttsky25a', rom: ROM, firmware: 'stock', mode: 'ASIC_RP_CONTROL', dipOn: [],
      demoSetting: false, demoRunning: false, demoPy: null, errors: [],
    });
    expect(info.projects).toBe(4);
    expect(info.main).toBe(stockMainFor(sdk2Version)!);
    expect(unsupportedReason(info)).toBeNull();
  });

  it('reads a DIP switch that is on, as the SDK does', async () => {
    // the SDK's desktop pin reads back its level, so a level of 1 stands for a switch that is on
    expect((await repl.check('print(tt.pins.ui_in3.is_input)\n')).trim()).toBe('False');
    await repl.check('tt.pins.ui_in3.raw_pin.val = 1\n');
    expect((await detect(repl)).dipOn).toEqual([3]);
    // released to read it, and left undriven as the SDK leaves a pin that reads high
    expect((await repl.check('print(tt.pins.ui_in3.is_input)\n')).trim()).toBe('True');
    await repl.check('tt.pins.ui_in3.raw_pin.val = 0\n');
    expect((await detect(repl)).dipOn).toEqual([]);
    // the SDK drives it again at its next mode change
    await repl.check('tt.mode = tt.mode\n');
    expect((await repl.check('print(tt.pins.ui_in3.is_input)\n')).trim()).toBe('False');
  });

  it("can't use the SDK 3.x helper: the port exists for a reason", async () => {
    await expect(repl.check('from ttboard.util.platform import IsRP2\n')).rejects.toThrow(/IsRP2/);
    await expect(repl.check('import ttboard.pins.gpio_map_dbv3\n')).rejects.toThrow(/gpio_map_dbv3/);
  });

  for (const name of readdirSync(path.join(FIX, 'bad')).filter((n) => !n.endsWith('.errors.json'))) {
    it(`validates bad/${name} word for word like the 3.x firmware`, async () => {
      const text = readFileSync(path.join(FIX, 'bad', name), 'utf8');
      const expected = JSON.parse(readFileSync(path.join(FIX, 'bad', name.replace(/\.json$/, '.errors.json')), 'utf8'));
      expect(await boardValidate(repl, info, text)).toEqual(expected);
    });
  }

  it('runs a sequence from RAM: the SDK enables the project and clocks it', async () => {
    const file = JSON.parse(readFileSync(path.join(FIX, 'good', 'minimal.json'), 'utf8'));
    expect(await runFromRam(repl, info, file)).toEqual([]);
    const out = await repl.check('print(tt.demo.running, tt.shuttle.enabled.name, tt.auto_clocking_freq, int(tt.ui_in.value))\n');
    // (the SDK's desktop port prints "Sim ..." lines as it reads the pins)
    expect(out.trim().split(/\r?\n/).pop()).toBe('True tt_um_10_vga_crossyroad 25000000 0');
    await stopDemo(repl);
    expect((await repl.check('print(tt.demo.running)\n')).trim()).toBe('False');
  });

  it('installs the helper, boots into the demo, turns it off, and resets to stock byte for byte', async () => {
    const main0 = info.main;
    const ini0 = info.configIni;
    expect(ini0).toBe(sdk2File('src/config.ini'));
    const seq = readFileSync(path.join(FIX, 'good', 'minimal.json'), 'utf8');
    const perm = planMakePermanent(info, seq);
    expect(perm.find((o) => o.path === '/demo.py')).toMatchObject({ text: HELPER_DEMO_PY.RP2040 });
    await applyOps(repl, perm);
    await reboot();
    expect(info).toMatchObject({ firmware: 'helper', demoSetting: true, demoRunning: true, demoErrors: [] });
    expect(planInstallHelper(info)).toEqual([]);
    expect((await repl.check('print(tt.shuttle.enabled.name, tt.auto_clocking_freq)\n')).trim()).toBe('tt_um_10_vga_crossyroad 25000000');
    // RAM runs on a helper board use the installed /demo.py
    expect(await runFromRam(repl, info, JSON.parse(seq))).toEqual([]);
    expect((await repl.check("import sys\nprint(_tdc_demo is sys.modules['demo'].__dict__)\n")).trim()).toBe('True');

    await applyOps(repl, planTurnOff(info));
    await reboot();
    expect(info).toMatchObject({ firmware: 'helper', demoSetting: false, demoRunning: false });

    const reset = planResetToStock(info);
    expect(stockWarnings(info, reset)).toEqual([]);
    await applyOps(repl, reset);
    await reboot();
    expect(info).toMatchObject({ firmware: 'stock', demoRunning: false, demoPy: null, mainStock: null, demoJson: null });
    expect(info.main).toBe(main0);
    expect(info.configIni).toBe(ini0);
  });

  it('shows the error pattern with the factory test when the sequence is bad at boot', async () => {
    await applyOps(repl, planMakePermanent(info, '{"version": 1, "shuttle": "ttsky25a", "projects": []}'));
    await reboot();
    expect(info.demoErrors).toEqual(['"projects" must be a non-empty list']);
    expect(info.demoRunning).toBe(false);
    // the factory test held in reset, the RP2040 driving "E" (0x79) on its inputs when the timer fires
    const out = await repl.check('tt.demo._error_display._blink(None)\nprint(tt.shuttle.enabled.name, int(tt.ui_in.value), tt.rst_n())\n');
    expect(out.trim().split(/\r?\n/).pop()).toBe('tt_um_factory_test 121 0');
    await applyOps(repl, planResetToStock(info));
  });
});
