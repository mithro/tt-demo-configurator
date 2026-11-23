#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fetch the VGA Playground's simulator (GPL-3.0, see src/vendor/README.md) into
// src/vendor/vga-playground/ at a pinned commit, checking every file's SHA-256. Run by
// `npm install` (postinstall); does nothing when the files are already there and match.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '3e3c77e46ae7bd51609f680851aabb81a30564a6';
const BASE = `https://raw.githubusercontent.com/TinyTapeout/vga-playground/${COMMIT}/`;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/vendor/vga-playground');

/** published path in vga-playground -> [path here, sha256] */
const FILES = {
  LICENSE: ['LICENSE', '589ed823e9a84c56feb95ac58e7cf384626b9cbf4fda2a907bc36e103de1bad2'],
  'src/sim/emu.ts': ['sim/emu.ts', 'a47022f423a13162a8be500e3801253c847e9cfe6e6e46e4b4283ee66cfadfd4'],
  'src/sim/hdlruntime.ts': ['sim/hdlruntime.ts', '3bab2eff762c52c6a0faffc045c3fd9ccf342811969fd8d2d35525e9fa2aff7d'],
  'src/sim/hdltypes.ts': ['sim/hdltypes.ts', '536b4a783c498118ab14a846b0719a928257a10ba3773ebeb7ff6a2cf41919ce'],
  'src/sim/hdlwasm.ts': ['sim/hdlwasm.ts', '0a5e3ebfdf52e3dc22b8f970ff7399700383ec516eb2a589ab74e43366a35938'],
  'src/sim/readmem.ts': ['sim/readmem.ts', '7ff5e875c4b06d189d52cfc1971286da6c3e431b56dc57ebe399c43a78cf0585'],
  'src/sim/util.ts': ['sim/util.ts', '5b5f6f794d346184f0fbff61bd03b2004970246fb60e93380a49b8c4421a9ff6'],
  'src/sim/vxmlparser.ts': ['sim/vxmlparser.ts', '4a9475dcc9372a083ee4805b4671abcd620705714e3fb4f1ebf95e6bbd9227da'],
  'src/sim/xml.ts': ['sim/xml.ts', '6aca0a4e36d6503195c5146e1cca360eae7ae29937e3e6cfa229701fa25b882a'],
  'src/verilator/verilator_bin.js': ['verilator/verilator_bin.js', '4cb4b1a36125356ab3ae71980463e9a524f3d0e08986b6c60bc3bbc3074945a6'],
  'src/verilator/verilator_bin.d.ts': ['verilator/verilator_bin.d.ts', 'fb9c1a0cdee6e98efe1a036dfe3ec006bb0ac82b83f6d1fac62c68e5e73a7797'],
  'src/verilator/verilator_bin.wasm': ['verilator/verilator_bin.wasm', 'b8bdb791c8eeb4820175c7ec42e01a40a47766bbb319137e999400f2a6a734c8'],
};

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

let fetched = 0;
for (const [from, [to, want]] of Object.entries(FILES)) {
  const dest = path.join(OUT, to);
  if (existsSync(dest) && sha(readFileSync(dest)) === want) continue;
  const r = await fetch(BASE + from);
  if (!r.ok) throw new Error(`fetch-sim-engine: ${BASE + from}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = sha(buf);
  if (got !== want) throw new Error(`fetch-sim-engine: ${from}: sha256 ${got}, expected ${want}`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  fetched++;
}
console.log(`fetch-sim-engine: vga-playground ${COMMIT.slice(0, 7)} in src/vendor/vga-playground (${fetched} file(s) fetched)`);
