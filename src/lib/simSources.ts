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

/**
 * Files a source may $readmem: names given to $readmem directly, and, when it uses
 * $readmem at all, string literals that look like data files (names are often parameters).
 */
export function readmemsOf(src: string): string[] {
  const s = stripVerilogComments(src);
  if (!/\$readmem[hb]/.test(s)) return [];
  const direct = [...s.matchAll(/\$readmem[hb]\s*\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const literals = [...s.matchAll(/"([^"\s]+\.(?:hex|mem|bin|txt|dat|rom))"/gi)].map((m) => m[1]);
  return [...new Set([...direct, ...literals])];
}

/**
 * Verilator 4.205 (the engine's) stops on lint codes it doesn't know, which newer
 * Verilator added (UNUSEDSIGNAL, WIDTHTRUNC, ...). The simulator doesn't lint, so drop the
 * `verilator lint_off/lint_on` comments altogether.
 */
export function dropLintDirectives(src: string): string {
  return src.replace(/\/\*\s*verilator\s+lint_\w+[^*]*\*\//g, '').replace(/\/\/\s*verilator\s+lint_\w+.*$/gm, '');
}

/** Verilator configuration (.vlt) is lint waivers here: not needed to simulate. */
const isVerilatorConfig = (f: string) => /\.vlt$/i.test(f);

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

/** "git@github.com:o/r.git" or "https://github.com/o/r(.git)" to "https://github.com/o/r". */
export function githubRepoUrl(url: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

/**
 * raw.githubusercontent.com doesn't follow git submodules. For the directories the missing
 * files are in, ask the GitHub API (60 requests an hour without a token) whether one is a
 * submodule, and record where it points. Returns true if any were found.
 */
async function findSubmodules(repo: string, commit: string, missing: string[], found: Map<string, [string, string]>, fetchFn: Fetch): Promise<boolean> {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(repo.trim());
  if (!m) return false;
  const dirs = new Set<string>();
  for (const f of missing) {
    const p = normPath(`src/${f}`);
    const parts = p?.split('/') ?? [];
    // src/<dir>/..., and the repo's own top level for paths like ../<dir>/...
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  let any = false;
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
    if ([...found.keys()].some((k) => dir === k || dir.startsWith(k + '/'))) continue;
    let r;
    try {
      r = await fetchFn(`https://api.github.com/repos/${m[1]}/${m[2]}/contents/${dir}?ref=${commit}`);
    } catch {
      return any;
    }
    if (!r.ok) continue;
    try {
      const j = JSON.parse(await r.text());
      const url = j && !Array.isArray(j) && j.type === 'submodule' ? githubRepoUrl(String(j.submodule_git_url ?? '')) : null;
      if (url && typeof j.sha === 'string') {
        found.set(dir, [url, j.sha]);
        any = true;
      }
    } catch {
      // not JSON: ignore
    }
  }
  return any;
}

/** Fetch everything the design needs to compile. Throws SourceError with a readable reason. */
export async function fetchDesignSources(
  d: { repo?: string; commit?: string; macro: string },
  fetchFn: Fetch = (u) => fetch(u),
): Promise<DesignSources> {
  if (!d.repo || !d.commit) throw new SourceError('the index has no repository and commit for this design');
  const repo = d.repo;
  const commit = d.commit;
  /** git submodules found so far: path in the repo -> [repo URL, commit] */
  const submodules = new Map<string, [string, string]>();
  const fetchText = async (url: string, path: string): Promise<string | null> => {
    let r;
    try {
      r = await fetchFn(url);
    } catch (e) {
      throw new SourceError(`couldn't fetch ${path}: ${(e as Error).message}`);
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new SourceError(`couldn't fetch ${path}: HTTP ${r.status}`);
    return r.text();
  };
  const get = async (path: string): Promise<string | null> => {
    for (const [dir, [subRepo, subCommit]] of submodules)
      if (path.startsWith(dir + '/')) return fetchText(rawUrl(subRepo, subCommit, path.slice(dir.length + 1)), path);
    return fetchText(rawUrl(repo, commit, path), path);
  };
  const info = await get('info.yaml');
  if (info === null) throw new SourceError(`no info.yaml in ${repo} at ${commit.slice(0, 7)}`);
  const meta = parseInfoYaml(info);
  const listed = meta.sourceFiles.filter((f) => !isVerilatorConfig(f));
  if (!listed.length) throw new SourceError('info.yaml lists no source_files');

  // in the listed order: Verilator reads them in turn, and `defines carry from file to file
  const fetchListed = () =>
    Promise.all(
      listed.map(async (f) => {
        const p = normPath(f);
        return [f, p, p === null ? null : await get(`src/${p}`)] as const;
      }),
    );
  let got = await fetchListed();
  const missingOf = () => got.filter(([, , t]) => t === null).map(([f]) => f);
  if (missingOf().length && (await findSubmodules(repo, commit, missingOf(), submodules, fetchFn))) got = await fetchListed();
  const missing = missingOf();
  if (missing.length) throw new SourceError(`missing source file${missing.length > 1 ? 's' : ''} ${missing.sort().join(', ')}`);
  const sources: Record<string, string> = {};
  for (const [, p, t] of got) sources[p!] = t!;

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
  for (const k of Object.keys(sources)) sources[k] = dropLintDirectives(sources[k]);
  return { sources, dataFiles, top: meta.topModule ?? d.macro, language: meta.language };
}
