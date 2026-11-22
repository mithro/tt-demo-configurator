// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardInfo } from './board';
import {
  HELPER_DEMO_PY,
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

const B = path.resolve(__dirname, '../../test/fixtures/boards');
const stockIni = readFileSync(path.join(B, 'stock-config.ini'), 'utf8');
const stock31 = stockMainFor('3.1.1')!;

function board(over: Partial<BoardInfo>): BoardInfo {
  return {
    machine: 'RP2350', sdk: '3.1.1', rp2350: true, shuttle: 'ttsky25a', rom: null, isFpga: false, projects: 237,
    firmware: 'stock', demoSetting: false, demoRunning: false, demoErrors: [], main: stock31, mainStock: null,
    configIni: stockIni, demoJson: null, demoPy: null, vgaCycle: null, errors: [], ...over,
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
    expect(planInstallHelper(board({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock31, demoPy: HELPER_DEMO_PY }))).toEqual([]);
  });
  it('makes permanent, turns off and resets to stock', () => {
    const helper = board({ firmware: 'helper', main: WRAPPER_MAIN, mainStock: stock31, demoPy: HELPER_DEMO_PY });
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
