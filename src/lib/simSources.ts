// SPDX-License-Identifier: Apache-2.0
// A design's Verilog, fetched from its repository at the commit the shuttle was built from
// (index.tinytapeout.com gives repo and commit): info.yaml's project.source_files under
// src/, the files they `include, and the files they $readmem.

export interface InfoYaml {
  sourceFiles: string[];
  topModule?: string;
  language?: string;
}

const unquote = (v: string): string => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

/** Drop a YAML comment, minding quotes. */
function stripComment(line: string): string {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/**
 * The fields of a Tiny Tapeout info.yaml the simulator needs. Not a YAML parser: it reads
 * the `project:` block's scalars and its `source_files` list (block or [flow] style),
 * which is all info.yaml uses there.
 */
export function parseInfoYaml(text: string): InfoYaml {
  const lines = text.split(/\r?\n/).map(stripComment);
  const out: InfoYaml = { sourceFiles: [] };
  let inProject = false;
  let projectIndent = -1;
  let listIndent = -1; // indent of the source_files key while reading its block list
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      inProject = /^project\s*:/.test(line);
      listIndent = -1;
      continue;
    }
    if (!inProject) continue;
    if (projectIndent < 0) projectIndent = indent;
    if (listIndent >= 0) {
      if (line.startsWith('-') && indent >= listIndent) {
        const v = unquote(line.slice(1));
        if (v) out.sourceFiles.push(v);
        continue;
      }
      listIndent = -1;
    }
    if (indent !== projectIndent) continue;
    const m = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'source_files') {
      const v = value.trim();
      if (v.startsWith('[')) {
        out.sourceFiles.push(...v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean));
      } else listIndent = indent;
    } else if (key === 'top_module') out.topModule = unquote(value) || undefined;
    else if (key === 'language') out.language = unquote(value) || undefined;
  }
  return out;
}

/** "https://github.com/o/r(.git)" and a path to a raw.githubusercontent.com URL (it allows CORS). */
export function rawUrl(repo: string, commit: string, path: string): string {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(repo.trim());
  if (!m) throw new Error(`not a GitHub repository: ${repo}`);
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${commit}/${path.replace(/^\.?\//, '')}`;
}

/** Normalise "a/./b/../c" (and leading "./"); null if it climbs out of the repository. */
export function normPath(p: string): string | null {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

const stripVerilogComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export function includesOf(src: string): string[] {
  return [...stripVerilogComments(src).matchAll(/`include\s+"([^"]+)"/g)].map((m) => m[1]);
}

export function readmemsOf(src: string): string[] {
  return [...stripVerilogComments(src).matchAll(/\$readmem[hb]\s*\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

export interface DesignSources {
  /** Verilog/SystemVerilog sources and headers, by path relative to src/. */
  sources: Record<string, string>;
  /** $readmem files, by the name the Verilog uses. */
  dataFiles: Record<string, string>;
  /** The top module (info.yaml's top_module, else the macro). */
  top: string;
  language?: string;
}

export class SourceError extends Error {}

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Fetch everything the design needs to compile. Throws SourceError with a readable reason. */
export async function fetchDesignSources(
  d: { repo?: string; commit?: string; macro: string },
  fetchFn: Fetch = (u) => fetch(u),
): Promise<DesignSources> {
  if (!d.repo || !d.commit) throw new SourceError('the index has no repository and commit for this design');
  const repo = d.repo;
  const commit = d.commit;
  const get = async (path: string): Promise<string | null> => {
    let r;
    try {
      r = await fetchFn(rawUrl(repo, commit, path));
    } catch (e) {
      throw new SourceError(`couldn't fetch ${path}: ${(e as Error).message}`);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new SourceError(`couldn't fetch ${path}: HTTP ${r.status}`);
    return r.text();
  };
  const info = await get('info.yaml');
  if (info === null) throw new SourceError(`no info.yaml in ${repo} at ${commit.slice(0, 7)}`);
  const meta = parseInfoYaml(info);
  if (!meta.sourceFiles.length) throw new SourceError('info.yaml lists no source_files');

  const sources: Record<string, string> = {};
  const missing: string[] = [];
  await Promise.all(
    meta.sourceFiles.map(async (f) => {
      const p = normPath(f);
      const text = p === null ? null : await get(`src/${p}`);
      if (text === null || p === null) missing.push(f);
      else sources[p] = text;
    }),
  );
  if (missing.length) throw new SourceError(`missing source file${missing.length > 1 ? 's' : ''} ${missing.sort().join(', ')}`);

  // `include files: relative to the including file's directory, or to src/ (-Isrc/)
  const seen = new Set(Object.keys(sources));
  let pending = Object.entries(sources);
  while (pending.length) {
    const next: [string, string][] = [];
    for (const [file, text] of pending) {
      for (const inc of includesOf(text)) {
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
        const options = [...new Set([normPath(dir + inc), normPath(inc)])].filter((p): p is string => p !== null);
        if (options.some((p) => seen.has(p))) continue;
        for (const p of options) {
          seen.add(p);
          const t = await get(`src/${p}`);
          if (t !== null) {
            sources[p] = t;
            next.push([p, t]);
            break;
          }
        }
      }
    }
    pending = next;
  }

  // $readmem files: cocotb runs from test/, others from the repo root or src/; try those
  const dataFiles: Record<string, string> = {};
  const names = new Set(Object.values(sources).flatMap(readmemsOf));
  await Promise.all(
    [...names].map(async (name) => {
      for (const base of ['src/', 'test/', '']) {
        const p = normPath(base + name);
        if (p === null) continue;
        const t = await get(p);
        if (t !== null) {
          dataFiles[name] = t;
          return;
        }
      }
    }),
  );
  return { sources, dataFiles, top: meta.topModule ?? d.macro, language: meta.language };
}
