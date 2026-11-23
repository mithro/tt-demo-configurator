// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dropLintDirectives, fetchDesignSources, githubRepoUrl, includeCandidates, includesOf, normPath, parseInfoYaml, rawUrl, readmemsOf, SourceError } from './simSources';

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
  it('reads a flow list spread over several lines', () => {
    const y = 'project:\n  source_files: [\n    "a.v",\n    b.v, c.v\n  ]\n  top_module: "tt_um_x"\n';
    expect(parseInfoYaml(y)).toEqual({ sourceFiles: ['a.v', 'b.v', 'c.v'], topModule: 'tt_um_x' });
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
    expect(readmemsOf('parameter F = "../src/logo.hex";\ninitial $readmemh(F, rom);')).toEqual(['../src/logo.hex']);
    expect(readmemsOf('parameter F = "../src/logo.hex";')).toEqual([]);
  });
  it('drops verilator lint comments, which the old Verilator stops on', () => {
    const v = '/*verilator lint_off UNUSEDSIGNAL*/\nwire a; // verilator lint_on WIDTHTRUNC\n/* keep */';
    expect(dropLintDirectives(v)).toBe('\nwire a; \n/* keep */');
  });
  it('reads GitHub repository URLs', () => {
    expect(githubRepoUrl('git@github.com:x/y.git')).toBe('https://github.com/x/y');
    expect(githubRepoUrl('https://github.com/x/y')).toBe('https://github.com/x/y');
    expect(githubRepoUrl('https://gitlab.com/x/y')).toBeNull();
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
    expect(Object.keys(d.sources).sort()).toEqual(['src/defs.vh', 'src/more.vh', 'src/project.v', 'src/sub/vga.v']);
    expect(d.compile).toEqual(['src/project.v', 'src/sub/vga.v']);
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

  it('follows a git submodule through the GitHub API', async () => {
    const f3: Record<string, string> = {
      'https://raw.githubusercontent.com/o/r/c0ffee/info.yaml': 'project:\n  source_files:\n    - top.v\n    - Sub/src/a.sv\n    - Sub/b.sv\n',
      'https://raw.githubusercontent.com/o/r/c0ffee/src/top.v': 'module top; endmodule',
      'https://api.github.com/repos/o/r/contents/src/Sub?ref=c0ffee': JSON.stringify({ type: 'submodule', submodule_git_url: 'git@github.com:x/sub.git', sha: 'beef' }),
      'https://raw.githubusercontent.com/x/sub/beef/src/a.sv': 'module a; endmodule',
      'https://raw.githubusercontent.com/x/sub/beef/b.sv': 'module b; endmodule',
    };
    const fake3 = async (u: string) => ({ ok: u in f3, status: u in f3 ? 200 : 404, text: async () => f3[u] ?? '' });
    const d = await fetchDesignSources({ repo, commit: 'c0ffee', macro: 'top' }, fake3);
    expect(Object.keys(d.sources)).toEqual(['src/top.v', 'src/Sub/src/a.sv', 'src/Sub/b.sv']);
  });

  /** a fake fetch over repo paths of o/r at c0ffee */
  const repoFetch = (tree: Record<string, string>) => async (u: string) => {
    const t = tree[u.replace('https://raw.githubusercontent.com/o/r/c0ffee/', '')];
    return { ok: t !== undefined, status: t === undefined ? 404 : 200, text: async () => t ?? '' };
  };

  it('loads listed sources outside src/ (review #1)', async () => {
    const d = await fetchDesignSources(
      { repo, commit: 'c0ffee', macro: 'top' },
      repoFetch({ 'info.yaml': 'project:\n  source_files:\n    - top.v\n    - ../ip/core.v\n', 'src/top.v': 'module top; endmodule', 'ip/core.v': 'module core; endmodule' }),
    );
    expect(d.compile).toEqual(['src/top.v', 'ip/core.v']);
    expect(d.sources['ip/core.v']).toBe('module core; endmodule');
  });

  it('resolves `include from the including file\'s directory first (review #5)', async () => {
    const d = await fetchDesignSources(
      { repo, commit: 'c0ffee', macro: 'top' },
      repoFetch({
        'info.yaml': 'project:\n  source_files:\n    - sub/top.v\n    - sub/defs.v\n    - helper.v\n',
        // sub/top.v includes "defs.v" (= src/sub/defs.v, a listed fragment) and "helper.v",
        // which exists as src/sub/helper.v: the listed src/helper.v is still a real source
        'src/sub/top.v': '`include "defs.v"\n`include "helper.v"\nmodule top; endmodule',
        'src/sub/defs.v': 'localparam X = 1;',
        'src/sub/helper.v': 'localparam Y = 2;',
        'src/helper.v': 'module helper; endmodule',
      }),
    );
    expect(d.compile).toEqual(['src/sub/top.v', 'src/helper.v']);
    expect(Object.keys(d.sources).sort()).toEqual(['src/helper.v', 'src/sub/defs.v', 'src/sub/helper.v', 'src/sub/top.v']);
  });

  it('lists include candidates as Verilator searches them', () => {
    expect(includeCandidates('src/sub/top.v', 'defs.v')).toEqual(['src/sub/defs.v', 'src/defs.v']);
    expect(includeCandidates('src/top.v', 'defs.v')).toEqual(['src/defs.v']);
    expect(includeCandidates('ip/core.v', '../src/defs.vh')).toEqual(['src/defs.vh']);
  });

  it('needs a repository and commit', async () => {
    await expect(fetchDesignSources({ macro: 'm' }, fake)).rejects.toBeInstanceOf(SourceError);
  });
});
