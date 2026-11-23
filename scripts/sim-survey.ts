// SPDX-License-Identifier: Apache-2.0
// How many of a shuttle's VGA designs the simulator preview can run: fetch each design's
// sources at its commit, compile, run up to three frames, and tabulate the outcome.
//
//   npx vite-node scripts/sim-survey.ts -- [--out=results.json] [--only=macro] ttsky25a tt08 ...
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchDesignSources, SourceError } from '~/lib/simSources';
import { loadShuttle, pmodsOf } from '~/lib/shuttleIndex';
import { VGA } from '~/lib/tinyVga';
import { instantiate, verilate } from '~/sim/verilate';
import { VgaSim } from '~/sim/vgaSim';

const args = process.argv.slice(2).filter((a) => a !== '--');
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const shuttles = args.filter((a) => !a.startsWith('--'));
// In Node, Emscripten's exit() (Verilator stopping on an error) calls process.exit; make it
// throw instead, as it does in a browser.
process.exit = ((code?: number) => {
  throw new Error(`exit(${code})`);
}) as typeof process.exit;
process.setMaxListeners(0);
process.on('unhandledRejection', (e) => console.log('unhandled rejection:', e));
const wasm = readFileSync(path.resolve(__dirname, '../src/vendor/vga-playground/verilator/verilator_bin.wasm'));

interface Row {
  shuttle: string;
  address: number;
  macro: string;
  title: string;
  clock_hz: number;
  language?: string;
  outcome: 'ok' | 'odd-timing' | 'blank' | 'no-sync' | 'fetch' | 'compile' | 'model' | 'run';
  reason?: string;
  compile_s?: number;
  fps?: number;
  lineClocks?: number;
  frameLines?: number;
}

const rows: Row[] = [];
for (const shuttle of shuttles) {
  const projects = (await loadShuttle(shuttle)).filter((p) => pmodsOf(shuttle, p).includes('tiny-vga') && (!only || p.macro === only));
  console.log(`== ${shuttle}: ${projects.length} Tiny VGA designs`);
  for (const p of projects) {
    const row: Row = { shuttle, address: p.address, macro: p.macro, title: p.title, clock_hz: p.clock_hz || VGA.pixelHz, outcome: 'ok' };
    rows.push(row);
    const t0 = Date.now();
    try {
      let src;
      try {
        src = await fetchDesignSources(p);
      } catch (e) {
        row.outcome = 'fetch';
        row.reason = (e as Error).message;
        continue;
      }
      row.language = src.language;
      const v = await verilate(src.top, src.sources, wasm);
      row.compile_s = (Date.now() - t0) / 1000;
      if (!v.ok) {
        row.outcome = 'compile';
        row.reason = `${v.stage}: ${v.reason}`;
        continue;
      }
      let mod;
      try {
        mod = await instantiate(v.modules, src.dataFiles);
      } catch (e) {
        row.outcome = 'model';
        row.reason = (e as Error).message;
        continue;
      }
      row.compile_s = (Date.now() - t0) / 1000;
      try {
        // as the app adds a design: its own clock, or the pixel clock when the index says 0
        const sim = new VgaSim(mod, { ui_in: 0, steps: [] }, row.clock_hz);
        const frameClocks = sim.frameClocks;
        const t1 = performance.now();
        let frames = 0;
        while (frames < 3 && sim.ticks < frameClocks * 4) if (sim.runFrame(frameClocks * 4 - sim.ticks)) frames++;
        const secs = (performance.now() - t1) / 1000;
        row.fps = Math.round((sim.ticks / frameClocks / secs) * 10) / 10;
        const st = sim.crt.stats();
        row.lineClocks = st.lineClocks;
        row.frameLines = st.frameLines;
        const lit = sim.crt.pixels.some((px) => px !== 0xff000000);
        if (frames < 2) {
          row.outcome = 'no-sync';
          row.reason = `${frames} frame(s) in 4 frames' time; line ${st.lineClocks} clocks`;
        } else if (!lit) {
          row.outcome = 'blank';
          row.reason = 'every pixel black after 3 frames';
        } else if (!sim.crt.standard()) {
          row.outcome = 'odd-timing';
          row.reason = `${(st.lineHz / 1000).toFixed(2)} kHz lines (${st.lineClocks} clocks), ${st.frameLines} lines/frame`;
        }
      } catch (e) {
        row.outcome = 'run';
        row.reason = (e as Error).message;
      } finally {
        mod.dispose();
      }
    } catch (e) {
      row.outcome = e instanceof SourceError ? 'fetch' : 'run';
      row.reason = `unexpected: ${(e as Error).message}`;
    } finally {
      console.log(`${shuttle} ${String(row.address).padStart(4)} ${row.outcome.padEnd(10)} ${(row.fps ?? '').toString().padStart(5)} fps  ${row.macro}  ${row.reason ?? ''}`);
    }
  }
}

console.log('\n== summary');
for (const shuttle of shuttles) {
  const r = rows.filter((x) => x.shuttle === shuttle);
  const by: Record<string, number> = {};
  for (const x of r) by[x.outcome] = (by[x.outcome] ?? 0) + 1;
  const ok = (by.ok ?? 0) + (by['odd-timing'] ?? 0);
  console.log(`${shuttle}: ${ok}/${r.length} produce a picture; ${JSON.stringify(by)}`);
}
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
