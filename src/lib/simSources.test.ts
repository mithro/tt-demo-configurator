// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchDesignSources, includesOf, normPath, parseInfoYaml, rawUrl, readmemsOf, SourceError } from './simSources';

const F = path.resolve(__dirname, '../../test/fixtures/sim');
const crossy = readFileSync(path.join(F, 'crossyroad-info.yaml'), 'utf8');

describe('parseInfoYaml', () => {
  it("reads a real info.yaml's source_files and top module", () => {
    expect(parseInfoYaml(crossy)).toEqual({
      sourceFiles: ['crossyroad.v', 'score.v', 'scroll_h.v', 'scroll_v.v', 'scroll_h_follower.v', 'scroll_v_follower.v', 'vga.v', 'tt_um_10_vga_crossyroad.v'],
      topModule: 'tt_um_10_vga_crossyroad',
      language: 'Verilog',
    });
  });
  it('reads flow lists, unquoted names and comments', () => {
    const y = 'project:\n  top_module: tt_um_x # top\n  source_files: [ "a.v", b.sv ]\npinout:\n  ui[0]: "x"\n';
    expect(parseInfoYaml(y)).toEqual({ sourceFiles: ['a.v', 'b.sv'], topModule: 'tt_um_x' });
  });
  it('stops the list at the next key and ignores lists outside project', () => {
    const y = 'documentation:\n  source_files:\n    - nope.v\nproject:\n  source_files:\n  - a.v # main\n  - "dir/b.v"\n  language: "Amaranth"\n';
    expect(parseInfoYaml(y)).toEqual({ sourceFiles: ['a.v', 'dir/b.v'], language: 'Amaranth' });
  });
});

describe('paths', () => {
  it('builds raw.githubusercontent.com URLs', () => {
    expect(rawUrl('https://github.com/o/r', 'abc', 'src/a.v')).toBe('https://raw.githubusercontent.com/o/r/abc/src/a.v');
    expect(rawUrl('https://github.com/o/r.git/', 'abc', './info.yaml')).toBe('https://raw.githubusercontent.com/o/r/abc/info.yaml');
    expect(() => rawUrl('https://gitlab.com/o/r', 'abc', 'x')).toThrow(/not a GitHub/);
  });
  it('normalises relative paths', () => {
    expect(normPath('./a/./b/../c.v')).toBe('a/c.v');
    expect(normPath('../x.v')).toBeNull();
  });
  it('finds `include and $readmem names, not in comments', () => {
    const v = '`include "defs.vh"\n// `include "old.vh"\ninitial $readmemh("rom.hex", mem);\n/* $readmemb("x.bin", m) */';
    expect(includesOf(v)).toEqual(['defs.vh']);
    expect(readmemsOf(v)).toEqual(['rom.hex']);
  });
});

describe('fetchDesignSources', () => {
  const repo = 'https://github.com/o/r';
  const files: Record<string, string> = {
    'info.yaml': 'project:\n  top_module: "tt_um_t"\n  source_files:\n    - project.v\n    - sub/vga.v\n',
    'src/project.v': '`include "defs.vh"\nmodule tt_um_t; initial $readmemh("rom.hex", m); endmodule',
    'src/defs.vh': '`include "more.vh"\n',
    'src/more.vh': '// nothing\n',
    'src/sub/vga.v': 'module vga; endmodule',
    'test/rom.hex': '00 01\n',
  };
  const urls: string[] = [];
  const fake = async (u: string) => {
    urls.push(u);
    const p = u.replace('https://raw.githubusercontent.com/o/r/c0ffee/', '');
    const t = files[p];
    return { ok: t !== undefined, status: t === undefined ? 404 : 200, text: async () => t ?? '' };
  };

  it('fetches the listed sources, their includes and $readmem files at the commit', async () => {
    const d = await fetchDesignSources({ repo, commit: 'c0ffee', macro: 'tt_um_other' }, fake);
    expect(d.top).toBe('tt_um_t');
    expect(Object.keys(d.sources).sort()).toEqual(['defs.vh', 'more.vh', 'project.v', 'sub/vga.v']);
    expect(d.dataFiles).toEqual({ 'rom.hex': '00 01\n' });
    expect(urls.every((u) => u.includes('/c0ffee/'))).toBe(true);
  });

  it('says which source file is missing', async () => {
    const f2 = { ...files, 'info.yaml': 'project:\n  source_files:\n    - project.v\n    - gone.v\n' };
    const fake2 = async (u: string) => {
      const t = f2[u.replace('https://raw.githubusercontent.com/o/r/c0ffee/', '') as keyof typeof f2];
      return { ok: t !== undefined, status: t === undefined ? 404 : 200, text: async () => t ?? '' };
    };
    await expect(fetchDesignSources({ repo, commit: 'c0ffee', macro: 'm' }, fake2)).rejects.toThrow('missing source file gone.v');
  });

  it('needs a repository and commit', async () => {
    await expect(fetchDesignSources({ macro: 'm' }, fake)).rejects.toBeInstanceOf(SourceError);
  });
});
