// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardInfo } from './board';
import {
  HELPER_DEMO_PY,
  helperDemoPy,
  isStockMain,
  planInstallHelper,
  planMakePermanent,
  planResetToStock,
  planTurnOff,
  setDemoLine,
  stockFromHandmade,
  stockMainFor,
  WRAPPER_MAIN,
} from './helper';
import { sha256Hex } from './sha256';

const B = path.resolve(__dirname, '../../test/fixtures/boards');
const stockIni = readFileSync(path.join(B, 'stock-config.ini'), 'utf8');
const stock31 = stockMainFor('3.1.1')!;
/** The port check runs scripts/port-demo-sdk2.py, which needs uv. */
const haveUv = !spawnSync('uv', ['--version']).error;

function board(over: Partial<BoardInfo>): BoardInfo {
  return {
    machine: 'RP2350', mcu: 'RP2350', sdk: '3.1.1', shuttle: 'ttsky25a', rom: null, isFpga: false, projects: 237,
    firmware: 'stock', demoSetting: false, mode: 'ASIC_RP_CONTROL', dipOn: [], demoRunning: false, demoErrors: [], main: stock31, mainStock: null,
    configIni: stockIni, demoJson: null, demoPySha256: null, vgaCycle: null, errors: [], ...over,
  };
}
const written = (ops: { op: string; path: string }[]) => ops.map((o) => `${o.op} ${o.path}`);

describe('setDemoLine', () => {
  it('adds demo = yes to [DEFAULT] of the stock config.ini and nothing else', () => {
    const out = setDemoLine(stockIni, 'yes');
    const diff = out.split('\n').filter((l) => !stockIni.split('\n').includes(l));
    expect(diff).toEqual(['demo = yes']);
    expect(out.indexOf('demo = yes')).toBeGreaterThan(out.indexOf('[DEFAULT]'));
    expect(out.indexOf('demo = yes')).toBeLessThan(out.indexOf('[', out.indexOf('[DEFAULT]') + 1));
    expect(setDemoLine(out, null)).toBe(stockIni);
  });
  it('replaces an existing value and goes after a commented one', () => {
    const ini = '[DEFAULT]\nx = 1\n# demo = no\ndemo = yes\ndemo=no\n[tt_um_a]\ndemo = yes\n';
    expect(setDemoLine(ini, 'no')).toBe('[DEFAULT]\nx = 1\n# demo = no\ndemo = no\n[tt_um_a]\ndemo = yes\n');
    expect(setDemoLine(ini, null)).toBe('[DEFAULT]\nx = 1\n# demo = no\n[tt_um_a]\ndemo = yes\n');
  });
  it('creates [DEFAULT] at the top when missing, and keeps CRLF', () => {
    expect(setDemoLine('[tt_um_a]\nclock = 1\n', 'yes')).toBe('[DEFAULT]\ndemo = yes\n\n[tt_um_a]\nclock = 1\n');
    expect(setDemoLine(null, 'yes')).toBe('[DEFAULT]\ndemo = yes\n\n');
    expect(setDemoLine('[DEFAULT]\r\na = 1\r\n', 'yes')).toBe('[DEFAULT]\r\ndemo = yes\r\na = 1\r\n');
    expect(setDemoLine('[tt_um_a]\n', null)).toBe('[tt_um_a]\n');
  });
});

describe('stock main.py', () => {
  it('recognises the released files and hand-made Shenzhen ones', () => {
    expect(isStockMain(stock31, '3.1.1')).toBe(true);
    expect(isStockMain(stock31, '3.0.7')).toBe(false);
    expect(isStockMain(stock31 + '\n')).toBe(false);
    expect(stockFromHandmade(readFileSync(path.join(B, 'handmade-main-3.1.py'), 'utf8'))).toBe(stock31);
    expect(stockFromHandmade(readFileSync(path.join(B, 'handmade-main-3.0.py'), 'utf8'))).toBe(stockMainFor('3.0.7'));
    expect(stockFromHandmade('print(1)\nimport vga_cycle\n')).toBeNull();
  });
});

describe('plans', () => {
  it('installs the helper on stock firmware, keeping main.py', () => {
    const ops = planInstallHelper(board({}));
    expect(written(ops)).toEqual(['write /demo.py', 'write /main_stock.py', 'write /main.py']);
    expect(ops[1]).toMatchObject({ text: stock31 });
    expect(ops[2]).toMatchObject({ text: WRAPPER_MAIN });
  });
  it('keeps a user-edited main.py as main_stock.py rather than losing it', () => {
    const ops = planInstallHelper(board({ main: 'print("mine")\n' }));
    expect(ops[1]).toMatchObject({ path: '/main_stock.py', text: 'print("mine")\n' });
  });
  it('migrates a hand-made board', () => {
    const main = readFileSync(path.join(B, 'handmade-main-3.1.py'), 'utf8');
    const ops = planInstallHelper(board({ firmware: 'handmade', main, vgaCycle: 'VGA_DESIGNS = []' }));
    expect(written(ops)).toEqual(['write /demo.py', 'write /main_stock.py', 'write /main.py', 'remove /vga_cycle.py']);
    expect(ops[1]).toMatchObject({ text: stock31 });
  });
  it('needs nothing on custom firmware or an up-to-date helper', () => {
    expect(planInstallHelper(board({ firmware: 'custom' }))).toEqual([]);
    expect(planInstallHelper(board({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock31, demoPySha256: sha256Hex(HELPER_DEMO_PY.RP2350) }))).toEqual([]);
  });
  it('makes permanent, turns off and resets to stock', () => {
    const helper = board({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock31, demoPySha256: sha256Hex(HELPER_DEMO_PY.RP2350) });
    expect(written(planMakePermanent(helper, '{}'))).toEqual(['write /demo.json', 'write /config.ini']);
    const on = { ...helper, configIni: setDemoLine(stockIni, 'yes'), demoJson: '{}' };
    expect((planTurnOff(on)[0] as { text: string }).text).toContain('demo = no');
    const reset = planResetToStock(on);
    expect(written(reset)).toEqual(['write /main.py', 'remove /main_stock.py', 'remove /demo.py', 'remove /demo.json', 'write /config.ini']);
    expect(reset[0]).toMatchObject({ text: stock31 });
    expect(reset[4]).toMatchObject({ text: stockIni });
    expect(planResetToStock(board({}))).toEqual([]);
  });
});

describe('RP2040 boards (SDK 2.x)', () => {
  const stock204 = stockMainFor('2.0.4')!;
  const ini204 = readFileSync(path.join(B, 'stock-config-2.0.4.ini'), 'utf8');
  const rp2040 = (over: Partial<BoardInfo>) =>
    board({ machine: 'Raspberry Pi Pico with RP2040', mcu: 'RP2040', sdk: '2.0.4', shuttle: 'tt07', main: stock204, configIni: ini204, ...over });
  it('knows every 2.0.x stock main.py', () => {
    for (const v of ['2.0.0', '2.0.1', '2.0.2', '2.0.3', '2.0.4']) expect(stockMainFor(v), v).toContain('BOOT: Tiny Tapeout SDK');
    expect(stockMainFor('2.0.2')).toBe(stockMainFor('2.0.1'));
    expect(isStockMain(stock204, '2.0.4')).toBe(true);
    expect(isStockMain(stock204, '2.0.3')).toBe(false);
  });
  it('installs the SDK 2.x helper, never the 3.x one', () => {
    expect(helperDemoPy({ mcu: 'RP2040' })).toBe(HELPER_DEMO_PY.RP2040);
    const ops = planInstallHelper(rp2040({}));
    expect(written(ops)).toEqual(['write /demo.py', 'write /main_stock.py', 'write /main.py']);
    expect(ops[0]).toMatchObject({ text: HELPER_DEMO_PY.RP2040 });
    expect(ops[1]).toMatchObject({ text: stock204 });
    // a board with the 3.x helper on it gets the 2.x one
    const wrong = rp2040({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock204, demoPySha256: sha256Hex(HELPER_DEMO_PY.RP2350) });
    expect(written(planInstallHelper(wrong))).toEqual(['write /demo.py']);
    const right = { ...wrong, demoPySha256: sha256Hex(HELPER_DEMO_PY.RP2040) };
    expect(planInstallHelper(right)).toEqual([]);
  });
  it('makes permanent and resets to the exact 2.0.4 stock files', () => {
    const helper = rp2040({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock204, demoPySha256: sha256Hex(HELPER_DEMO_PY.RP2040) });
    const perm = planMakePermanent(helper, '{}');
    expect(written(perm)).toEqual(['write /demo.json', 'write /config.ini']);
    const ini = (perm[1] as { text: string }).text;
    expect(ini.split('\n').filter((l) => !ini204.split('\n').includes(l))).toEqual(['demo = yes']);
    const reset = planResetToStock({ ...helper, configIni: ini, demoJson: '{}' });
    expect(reset[0]).toMatchObject({ path: '/main.py', text: stock204 });
    expect(reset.find((o) => o.path === '/config.ini')).toMatchObject({ text: ini204 });
  });
  it.skipIf(!haveUv)('has the SDK 2.x helper exactly as scripts/port-demo-sdk2.py makes it from the pinned demo.py', () => {
    const REPO = path.resolve(__dirname, '../..');
    const out = execFileSync('uv', ['run', '--no-project', 'python', '-I', 'scripts/port-demo-sdk2.py', 'src/data/demo.py', '-'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(out).toBe(HELPER_DEMO_PY.RP2040);
  });
});
