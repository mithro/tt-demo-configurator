// SPDX-License-Identifier: Apache-2.0
// Verilog to a runnable module, with the VGA Playground's engine (src/vendor/README.md):
// Verilator (WebAssembly) elaborates the design and dumps it as XML, which the engine turns
// into a WebAssembly model. Works in a Web Worker and in Node.
import type { HDLModuleDef } from '~/vendor/vga-playground/sim/hdltypes';
import { HDLModuleWASM } from '~/vendor/vga-playground/sim/hdlwasm';
import { VerilogXMLParser } from '~/vendor/vga-playground/sim/vxmlparser';
import verilator_bin from '~/vendor/vga-playground/verilator/verilator_bin';
import { includesOf } from '~/lib/simSources';
import { cellModels } from './cells';

export type Verilated =
  | { ok: true; modules: Record<string, HDLModuleDef>; warnings: number }
  | { ok: false; stage: 'verilator' | 'xml'; reason: string; log: string[] };

const isHeader = (f: string) => /\.(vh|svh|vinc|inc)$/i.test(f);

/** First few Verilator errors, readable on one line each. */
export function errorSummary(log: string[], max = 3): string {
  const errs = log
    .filter((l) => l.startsWith('%Error'))
    .filter((l) => !/^%Error: Exiting due to/.test(l))
    .map((l) => l.replace(/^%Error(-[A-Z0-9_]+)?: /, '').replace(/(^|\s)src\//g, '$1'));
  if (!errs.length) return log.filter((l) => l.trim()).slice(-2).join(' ') || 'Verilator failed without saying why';
  const more = errs.length > max ? ` (and ${errs.length - max} more)` : '';
  return errs.slice(0, max).join('; ') + more;
}

export async function verilate(top: string, sources: Record<string, string>, wasmBinary: ArrayBuffer | Uint8Array): Promise<Verilated> {
  const log: string[] = [];
  const inst = verilator_bin({
    wasmBinary,
    noInitialRun: true,
    noExitRuntime: true,
    print: (s: string) => log.push(s),
    printErr: (s: string) => log.push(s),
  });
  await inst.ready;
  const { FS } = inst;
  const dirs = new Set<string>();
  FS.mkdir('src');
  dirs.add('src');
  const files: string[] = [];
  const cells = cellModels(sources);
  const included = new Set(Object.values(sources).flatMap(includesOf).map((f) => f.replace(/^(\.\/)+/, '')));
  const all = cells ? { ...sources, 'tt_sim_sky130_cells.v': cells } : sources;
  for (const [name, text] of Object.entries(all)) {
    const p = `src/${name}`;
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!dirs.has(d)) {
        FS.mkdir(d);
        dirs.add(d);
      }
    }
    FS.writeFile(p, text);
    // a listed file that another one `includes is a fragment, not a file to compile
    if (!isHeader(name) && !included.has(name)) files.push(p);
  }
  const args = [
    '--cc',
    '-O3',
    '-Wno-fatal',
    '-Wno-lint',
    '-Wno-style',
    '--x-assign',
    'fast',
    '--debug-check', // makes Verilator write obj_dir/V<top>.xml
    ...[...dirs].map((d) => `-I${d}/`),
    '--top-module',
    top,
    ...files,
  ];
  try {
    inst.callMain(args);
  } catch (e) {
    // Emscripten's exit() throws; Verilator exits non-zero on errors
    if (!log.some((l) => l.startsWith('%Error'))) log.push(`%Error: ${(e as Error).message ?? e}`);
  }
  if (log.some((l) => l.startsWith('%Error'))) return { ok: false, stage: 'verilator', reason: errorSummary(log), log };
  const parser = new VerilogXMLParser();
  try {
    parser.parse(FS.readFile(`obj_dir/V${top}.xml`, { encoding: 'utf8' }));
  } catch (e) {
    return { ok: false, stage: 'xml', reason: `the simulator can't handle this design: ${(e as Error).message ?? e}`, log };
  }
  return { ok: true, modules: parser.modules, warnings: log.filter((l) => l.startsWith('%Warning')).length };
}

/** Build the WebAssembly model. Throws (an HDLError, usually) on constructs it can't model. */
export async function instantiate(modules: Record<string, HDLModuleDef>, dataFiles: Record<string, string>): Promise<HDLModuleWASM> {
  const top = modules['TOP'];
  if (!top) throw new Error('Verilator produced no TOP module');
  const mod = new HDLModuleWASM(top, modules['@CONST-POOL@'] ?? null);
  await mod.init();
  mod.getFileData = (path) => dataFiles[path] ?? dataFiles[path.replace(/^(\.\.?\/)+/, '')];
  return mod;
}

export type { HDLModuleWASM };
