// SPDX-License-Identifier: Apache-2.0
// The simulator Web Worker: fetches a design's sources, compiles them with the VGA
// Playground's Verilator/WebAssembly engine (GPL-3.0, src/vendor/README.md), and runs it,
// posting each finished 640x480 frame. Compiled designs are cached for the session.
/// <reference lib="webworker" />
import { fetchDesignSources, SourceError } from '~/lib/simSources';
import { VGA } from '~/lib/tinyVga';
import wasmUrl from '~/vendor/vga-playground/verilator/verilator_bin.wasm?url';
import type { FromWorker, SimDesign, SimEntry, SimStats, ToWorker } from './protocol';
import { type HDLModuleWASM, instantiate, verilate } from './verilate';
import { VgaSim } from './vgaSim';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

let wasmBinary: Promise<ArrayBuffer> | null = null;
const verilatorWasm = () =>
  (wasmBinary ??= fetch(wasmUrl).then((r) => {
    if (!r.ok) throw new Error(`couldn't load the Verilator engine: HTTP ${r.status}`);
    return r.arrayBuffer();
  }));

type Built = { mod: HDLModuleWASM } | { error: string; stage: 'fetch' | 'compile' };
/** compiled designs by repo@commit:macro; failures are cached too */
const built = new Map<string, Promise<Built>>();
const keyOf = (d: SimDesign) => `${d.repo}@${d.commit}:${d.macro}`;

async function build(d: SimDesign, token: number): Promise<Built> {
  post({ type: 'status', token, state: 'fetching' });
  let src;
  try {
    src = await fetchDesignSources(d);
  } catch (e) {
    return { stage: 'fetch', error: e instanceof SourceError ? e.message : `couldn't fetch the sources: ${(e as Error).message}` };
  }
  if (cur?.token === token) post({ type: 'status', token, state: 'compiling', note: `${Object.keys(src.sources).length} file(s)${src.language ? `, ${src.language}` : ''}` });
  try {
    const v = await verilate(src.top, src.sources, src.compile, await verilatorWasm());
    if (!v.ok) return { stage: 'compile', error: v.stage === 'verilator' ? `Verilator: ${v.reason}` : v.reason };
    return { mod: await instantiate(v.modules, src.dataFiles) };
  } catch (e) {
    return { stage: 'compile', error: `the simulator can't model this design: ${(e as Error).message ?? e}` };
  }
}

interface Current {
  token: number;
  sim: VgaSim | null;
  running: boolean;
  /** what the app last asked for */
  want: boolean;
  /** wall-clock ms spent running, up to the moment the run last paused/resumed */
  runMs: number;
  since: number;
  note?: string;
  window: { t: number; frames: number; ticks: number };
  stats: SimStats;
}
let cur: Current | null = null;

function snapshot(c: Current): SimStats {
  const sim = c.sim!;
  const st = sim.crt.stats();
  const now = performance.now();
  const w = c.window;
  const dt = (now - w.t) / 1000;
  if (dt >= 1 || !c.stats.fps) {
    if (dt > 0.2) {
      c.stats.fps = Math.round((w.frames / dt) * 10) / 10;
      c.stats.speed = (sim.ticks - w.ticks) / sim.clockHz / dt;
      c.window = { t: now, frames: 0, ticks: sim.ticks };
    }
  }
  return {
    ...c.stats,
    simMs: sim.simMs(),
    uiIn: sim.uiIn,
    lineClocks: st.lineClocks,
    frameLines: st.frameLines,
    lineHz: st.lineHz,
    standard: sim.crt.standard(),
    noSync: st.sinceHsync > (sim.frameClocks / VGA.frameLines) * 4,
  };
}

function postFrame(c: Current) {
  const pixels = c.sim!.crt.pixels.slice().buffer;
  post({ type: 'frame', token: c.token, pixels, stats: snapshot(c) }, [pixels]);
}

async function loop(c: Current) {
  const sim = c.sim!;
  const frameClocks = sim.frameClocks;
  let lastStats = 0;
  while (cur === c && c.running) {
    const start = performance.now();
    // never run ahead of real time: the board doesn't either
    const wallMs = c.runMs + (start - c.since);
    let budget = Math.floor((wallMs * sim.clockHz) / 1000) - sim.ticks;
    try {
      while (budget > 0 && performance.now() - start < 30) {
        const n = Math.min(budget, frameClocks);
        const before = sim.ticks;
        if (sim.runFrame(n)) {
          c.window.frames++;
          postFrame(c);
        }
        budget -= sim.ticks - before;
      }
    } catch (e) {
      post({ type: 'status', token: c.token, state: 'failed', reason: `the simulation stopped: ${(e as Error).message ?? e}` });
      c.running = false;
      return;
    }
    const now = performance.now();
    if (now - lastStats > 500) {
      lastStats = now;
      post({ type: 'stats', token: c.token, stats: snapshot(c) });
    }
    // yield so messages (pause, another design) get through; sleep if ahead of real time
    await new Promise((r) => setTimeout(r, budget > 0 ? 0 : 5));
  }
}

function setRunning(c: Current, run: boolean) {
  c.want = run;
  if (!c.sim) return; // still fetching or compiling: load() starts it as wanted
  if (c.running === run) return;
  const now = performance.now();
  if (run) {
    c.since = now;
    c.window = { t: now, frames: 0, ticks: c.sim?.ticks ?? 0 };
  } else c.runMs += now - c.since;
  c.running = run;
  post({ type: 'status', token: c.token, state: run ? 'running' : 'paused', note: c.note });
  if (run) void loop(c);
}

async function load(token: number, design: SimDesign, entry: SimEntry, run: boolean) {
  const c: Current = { token, sim: null, want: run, running: false, runMs: 0, since: 0, window: { t: 0, frames: 0, ticks: 0 }, stats: { fps: 0, speed: 0 } as SimStats };
  cur = c;
  if (!entry.clock_hz) {
    post({ type: 'status', token, state: 'failed', reason: 'this entry stops the clock (clock_hz 0), so the design shows nothing' });
    return;
  }
  const key = keyOf(design);
  let p = built.get(key);
  if (!p) {
    p = build(design, token);
    built.set(key, p);
  } else post({ type: 'status', token, state: 'compiling', note: 'compiled earlier' });
  const b = await p;
  if (cur !== c) return;
  if ('error' in b) {
    // a network failure may be temporary: let the next attempt fetch again
    if (b.stage === 'fetch') built.delete(key);
    post({ type: 'status', token, state: 'failed', reason: b.error });
    return;
  }
  try {
    c.sim = new VgaSim(b.mod, entry, entry.clock_hz);
    // a first frame to look at even while held
    c.sim.runFrame(c.sim.frameClocks * 2);
    c.sim.runFrame(c.sim.frameClocks * 2);
    postFrame(c);
  } catch (e) {
    post({ type: 'status', token, state: 'failed', reason: `the simulation stopped: ${(e as Error).message ?? e}` });
    return;
  }
  post({ type: 'status', token, state: 'paused', note: c.note });
  // the first frames count as run time, so pacing starts level with them
  c.runMs = c.sim.simMs();
  setRunning(c, c.want);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'load') void load(m.token, m.design, m.entry, m.run);
  else if (m.type === 'run') {
    if (cur && cur.token === m.token) setRunning(cur, m.run);
  } else if (m.type === 'unload') {
    if (cur) cur.running = false;
    cur = null;
  }
};

post({ type: 'ready', token: 0 });
