// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDemoText, validateDemo } from './demoFile';
import { importHandmade, parseVgaCycle } from './handmade';
import type { Project } from './shuttleIndex';

const B = path.resolve(__dirname, '../../test/fixtures/boards');
const read = (n: string) => readFileSync(path.join(B, n), 'utf8');
const DEMOS = path.resolve(__dirname, '../data/demos');

describe('parseVgaCycle', () => {
  it('reads the ttsky25a board, players and active-low idle values included', () => {
    const list = parseVgaCycle(read('vga_cycle-ttsky25a.py'));
    expect(list).toHaveLength(14);
    expect(list[5]).toEqual({ macro: 'tt_um_10_vga_crossyroad', ui_in: 0, player: 'play_crossyroad' });
    expect(list[12]).toEqual({ macro: 'tt_um_RoyTr16', ui_in: 7, player: 'play_connect_four' });
    expect(list[13]).toEqual({ macro: 'tt_um_7FM_ShadyPong', ui_in: 31, player: 'play_shady_pong' });
  });
  it('reads the other three boards', () => {
    expect(parseVgaCycle(read('vga_cycle-ttgf0p3.py')).map((e) => e.macro)).toEqual([
      'tt_um_a1k0n_nyancat', 'tt_um_waferspace_vga_screensaver', 'tt_um_combined', 'tt_um_2048_vga_game',
    ]);
    expect(parseVgaCycle(read('vga_cycle-ttsky25b.py'))).toHaveLength(7);
    expect(parseVgaCycle(read('vga_cycle-tt09.py'))).toHaveLength(8);
  });
});

describe('importHandmade', () => {
  it('maps macros to addresses and flags the players', () => {
    const projects: Project[] = [
      { macro: 'tt_um_RoyTr16', address: 260, subtile: 0, title: 'C4', author: '', clock_hz: 25000000, pinout: {} },
      { macro: 'tt_um_sleepwell', address: 130, subtile: 0, title: 's', author: '', clock_hz: 0, pinout: {} },
    ];
    const r = importHandmade(read('vga_cycle-ttsky25a.py'), 'ttsky25a', projects);
    expect(r.file.projects).toEqual([
      { address: 130, subtile: 0, duration_ms: 15000, clock_hz: 25175000, ui_in: 0, steps: [] },
      { address: 260, subtile: 0, duration_ms: 15000, clock_hz: 25000000, ui_in: 7, steps: [] },
    ]);
    expect(r.needsScript).toEqual([{ index: 1, macro: 'tt_um_RoyTr16', player: 'play_connect_four' }]);
    expect(r.missing).toHaveLength(12);
    expect(validateDemo(r.file, 'ttsky25a')).toEqual([]);
  });
});

describe('bundled ready-made sequences', () => {
  for (const shuttle of ['ttgf0p3', 'ttsky25b', 'tt09', 'ttsky25a']) {
    it(`${shuttle}.demo.json is valid and follows its Shenzhen board`, () => {
      const { file, errors } = parseDemoText(readFileSync(path.join(DEMOS, `${shuttle}.demo.json`), 'utf8'), shuttle);
      expect(errors).toEqual([]);
      expect(file!.projects).toHaveLength(parseVgaCycle(read(`vga_cycle-${shuttle}.py`)).length);
    });
  }
  it('tt08.demo.json is valid', () => {
    const { file, errors } = parseDemoText(readFileSync(path.join(DEMOS, 'tt08.demo.json'), 'utf8'), 'tt08');
    expect(errors).toEqual([]);
    expect(file!.projects).toHaveLength(21);
  });
  it('gives the three games fixed scripts', () => {
    const file = JSON.parse(readFileSync(path.join(DEMOS, 'ttsky25a.demo.json'), 'utf8'));
    const by = Object.fromEntries(file.projects.map((p: { address: number }) => [p.address, p]));
    expect(by[907].steps.length).toBeGreaterThan(0);
    expect(by[260]).toMatchObject({ ui_in: 7 });
    expect(by[260].steps[0]).toEqual({ set: 5 }); // first press: right (ui[1] low)
    expect(by[674]).toMatchObject({ ui_in: 31 });
  });
});
