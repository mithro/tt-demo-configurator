// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { loadSearchInfo, PMOD_LIST, searchUrl } from './projectSearch';
import { pmodsOf, toProject } from './shuttleIndex';

describe('project-search data', () => {
  it('lists the Pmods, Tiny VGA first', () => {
    expect(PMOD_LIST[0].id).toBe('tiny-vga');
    expect(PMOD_LIST.map((p) => p.id)).toContain('gamepad');
  });
  it('loads one shuttle: Pmods, tags and silicon reports per macro', async () => {
    const info = await loadSearchInfo('ttsky25a');
    const rom = info['tt_um_rom_vga_screensaver'];
    expect(rom.pmods).toEqual(expect.arrayContaining(['tiny-vga', 'gamepad']));
    expect(rom.tags).toContain('vga');
    expect(rom.silicon.status).toBe('working');
    expect(rom.silicon.working).toBeGreaterThan(0);
  });
  it('has nothing for a shuttle it does not know', async () => {
    expect(await loadSearchInfo('tt99')).toEqual({});
  });
  it('links a design to the search page', () => {
    expect(searchUrl('ttsky25a', 'tt_um_x')).toBe('https://mith.ro/tinytapeout-project-search/#q=tt_um_x&shuttle=ttsky25a');
  });
});

describe('pmodsOf', () => {
  const base = { macro: 'tt_um_nobody', address: 1, pinout: {} };
  const silicon = { status: 'untested' as const, working: 0, partial: 0, broken: 0 };
  it('joins the database Pmods with the videos list', () => {
    const p = { ...toProject(base), search: { pmods: ['gamepad', 'tt-audio'], tags: [], silicon } };
    expect(pmodsOf('tt99', p)).toEqual(['gamepad', 'tt-audio']);
  });
  it('falls back to the Tiny VGA pinout check', () => {
    const pinout = { 'uo[0]': 'R1', 'uo[1]': 'G1', 'uo[2]': 'B1', 'uo[3]': 'VSync', 'uo[7]': 'HSync' };
    expect(pmodsOf('tt99', toProject({ ...base, pinout }))).toEqual(['tiny-vga']);
    expect(pmodsOf('tt99', toProject(base))).toEqual([]);
  });
});
