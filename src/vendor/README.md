# src/vendor/vga-playground: the Tiny Tapeout VGA Playground simulator

`npm install` (the `postinstall` script, `scripts/fetch-sim-engine.mjs`) downloads these
files from https://github.com/TinyTapeout/vga-playground at commit
`3e3c77e46ae7bd51609f680851aabb81a30564a6` (2026-08-26), unchanged, and checks each
file's SHA-256. They are not committed here (the directory is git-ignored).

- `sim/` — from `src/sim/`. The VGA Playground says: "The source code of the simulator is
  based on 8bitworkshop (https://github.com/sehugg/8bitworkshop). 8-bit workshop is
  released under the GPL v3 license."
- `verilator/` — `verilator_bin.js` / `verilator_bin.wasm`: an Emscripten build of
  Verilator 4.205 (Verilator is LGPL-3.0-only or Artistic-2.0).
- `LICENSE` — the VGA Playground's licence, GPL-3.0.

How it works: Verilator (as WebAssembly) parses and elaborates the design and dumps its
AST as XML (`--debug-check`); `sim/vxmlparser.ts` reads that into an `HDLModuleDef`;
`sim/hdlwasm.ts` compiles that to a WebAssembly module with binaryen (Apache-2.0, an npm
dependency) and runs it, one `tick2()` per clock. `src/sim/` here drives it.

## Licence

**This code is GPL-3.0, not Apache-2.0 like the rest of this app.** Only the simulator Web
Worker (`src/sim/sim.worker.ts`) imports it; Vite builds the worker into its own chunk and
the rest of the app talks to it by `postMessage`. The published worker bundle therefore
contains GPL-3.0 code, and its source must stay available under GPL-3.0 (this repository
and the upstream one provide it). The repository owner approved shipping it this way
on 2026-11-23.
