// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FPGA4_BITSTREAMS } from '~/testing/fpga4';
import { defaultMatchDeps, fpgaProjects, matchKnown } from './fpga';
import { indexLookup, mediaShuttle, Project } from './shuttleIndex';

const designs = FPGA4_BITSTREAMS.map((name, address) => ({ address, name }));

const chipProject = (over: Partial<Project>): Project => ({
  macro: 'tt_um_factory_test',
  address: 5,
  subtile: 0,
  title: 'Factory Test',
  author: 'Tiny Tapeout',
  clock_hz: 10,
  repo: 'https://github.com/TinyTapeout/tt-factory-test',
  commit: 'abc123',
  danger_level: 'safe',
  pinout: { 'ui[0]': 'counter / loopback' },
  ...over,
});

describe('fpgaProjects', () => {
  it('makes a design of each bitstream, at the address the board gives it, titled by its name', () => {
    const list = fpgaProjects(designs);
    expect(list.map((p) => [p.address, p.subtile, p.macro, p.title])).toEqual(designs.map((d) => [d.address, 0, d.name, d.name]));
    expect(list[0]).toEqual({ macro: 'custom', address: 0, subtile: 0, title: 'custom', author: '', clock_hz: 0, pinout: {} });
  });
  it('gives the validator every address the board has, none of them refused', () => {
    const lookup = indexLookup(fpgaProjects(designs));
    expect(lookup(7)).toEqual({ name: 'tt_um_vga_pattern', dangerous: false });
    expect(lookup(8)).toBeNull();
  });
});

describe('matchKnown', () => {
  const order = ['ttsky26c', 'ttsky25b', 'ttsky25a', 'tt09'];
  const shuttles: Record<string, Project[]> = {
    ttsky26c: [chipProject({ address: 2, clock_hz: 0, danger_level: 'high' })],
    tt09: [chipProject({ macro: 'tt_um_vga_pattern', title: 'A VGA thing', address: 300 })],
  };
  const loaded: string[] = [];
  const deps = {
    order,
    hasVideo: (shuttle: string, macro: string) => shuttle === 'tt09' && macro === 'tt_um_vga_pattern',
    searchMacros: async (shuttle: string) => new Set((shuttles[shuttle] ?? []).map((p) => p.macro)),
    loadShuttle: async (id: string) => {
      loaded.push(id);
      return shuttles[id] ?? [];
    },
  };
  it('takes a design matched by name from the newest shuttle that has it, keeping the board address', async () => {
    const { projects: out, errors } = await matchKnown(fpgaProjects(designs), deps);
    expect(errors).toEqual([]);
    const factory = out.find((p) => p.macro === 'tt_um_factory_test')!;
    expect(factory).toMatchObject({ address: 4, subtile: 0, title: 'Factory Test', author: 'Tiny Tapeout', clock_hz: 0, commit: 'abc123' });
    expect(factory.known).toEqual({ shuttle: 'ttsky26c', address: 2, subtile: 0 });
    expect(mediaShuttle('FPGA', factory)).toBe('ttsky26c');
    // the chip's danger level is not the board's: the FPGA board enables any bitstream
    expect(factory.danger_level).toBeUndefined();
    expect(indexLookup(out)(4)).toEqual({ name: 'tt_um_factory_test', dangerous: false });
  });
  it('prefers a shuttle with a recording, so the preview has a clip', async () => {
    const { projects: out, errors } = await matchKnown(fpgaProjects(designs), deps);
    expect(errors).toEqual([]);
    expect(out.find((p) => p.macro === 'tt_um_vga_pattern')).toMatchObject({ address: 7, title: 'A VGA thing', known: { shuttle: 'tt09', address: 300 } });
  });
  it('leaves the others as the board names them, and loads each shuttle index once', async () => {
    loaded.length = 0;
    const { projects: out, errors } = await matchKnown(fpgaProjects(designs), deps);
    expect(errors).toEqual([]);
    expect(out.find((p) => p.macro === 'custom')).toEqual(fpgaProjects(designs)[0]);
    expect(mediaShuttle('FPGA', out[0])).toBe('FPGA');
    expect(loaded.sort()).toEqual(['tt09', 'ttsky26c']);
  });
  it("with the app's own data, matches fpga-4's factory test and nothing else", async () => {
    const real = { ...defaultMatchDeps(['ttsky26c', 'ttsky25a', 'tt09']), loadShuttle: deps.loadShuttle };
    const { projects } = await matchKnown(fpgaProjects(designs), real);
    expect(projects.filter((p) => p.known).map((p) => [p.macro, p.known!.shuttle])).toEqual([['tt_um_factory_test', 'ttsky26c']]);
  });
  it('keeps the board names when a shuttle index cannot be loaded', async () => {
    const { projects, errors } = await matchKnown(fpgaProjects(designs), { ...deps, loadShuttle: async () => Promise.reject(new Error('HTTP 503')) });
    expect(projects).toEqual(fpgaProjects(designs));
    expect(errors).toEqual([
      "couldn't load the ttsky26c project list to name tt_um_factory_test: Error: HTTP 503",
      "couldn't load the tt09 project list to name tt_um_vga_pattern: Error: HTTP 503",
    ]);
  });
});
