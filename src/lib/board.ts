// SPDX-License-Identifier: Apache-2.0
// What is on a connected board, and moving files to and from it over the raw REPL.
import detectPy from './py/detect.py?raw';
import { RawRepl, ReplError } from './rawRepl';

/** The marker the stock-firmware helper's wrapper main.py carries. */
export const HELPER_MARKER = '# tt-demo-configurator helper';

export type FirmwareType = 'custom' | 'helper' | 'stock' | 'handmade';

export interface BoardInfo {
  machine: string;
  /** SDK version, e.g. "3.1.1"; null when unknown. */
  sdk: string | null;
  rp2350: boolean;
  shuttle: string | null;
  rom: Record<string, string> | string | null;
  isFpga: boolean;
  projects: number | null;
  firmware: FirmwareType;
  /** config.ini [DEFAULT] demo = yes, as the firmware's parser reads it. */
  demoSetting: boolean;
  /** The board's input mode, e.g. "ASIC_RP_CONTROL"; null if unknown. */
  mode: string | null;
  /** ui_in bits whose DIP switch is on (should be empty); null if they couldn't be read. */
  dipOn: number[] | null;
  demoRunning: boolean;
  demoErrors: string[];
  main: string | null;
  mainStock: string | null;
  configIni: string | null;
  demoJson: string | null;
  demoPy: string | null;
  vgaCycle: string | null;
  errors: string[];
}

/** Turn detect.py's output into BoardInfo. */
export function parseDetect(out: string): BoardInfo {
  const line = out.split(/\r?\n/).find((l) => l.startsWith('DETECT:'));
  if (!line) throw new ReplError(`the board did not report its state: ${out.slice(0, 300)}`);
  const r = JSON.parse(line.slice('DETECT:'.length));
  const main: string | null = r.main;
  let firmware: FirmwareType = 'stock';
  if (r.firmware_demo) firmware = 'custom';
  else if (r.demo_py !== null && main?.includes(HELPER_MARKER)) firmware = 'helper';
  else if (r.vga_cycle !== null && /\bimport\s+vga_cycle\b/.test(main ?? '')) firmware = 'handmade';
  const sdk: string | null = r.sdk ?? r.release ?? null;
  return {
    machine: r.machine,
    sdk,
    rp2350: /RP2350/i.test(r.machine),
    shuttle: r.shuttle,
    rom: r.rom,
    isFpga: typeof r.shuttle === 'string' && r.shuttle.toUpperCase() === 'FPGA',
    projects: r.projects,
    firmware,
    demoSetting: !!r.demo_setting,
    mode: r.mode ?? null,
    dipOn: r.dip_on ?? null,
    demoRunning: !!r.demo_running,
    demoErrors: r.demo_errors ?? [],
    main,
    mainStock: r.main_stock,
    configIni: r.config_ini,
    demoJson: r.demo_json,
    demoPy: r.demo_py,
    vgaCycle: r.vga_cycle,
    errors: r.errors ?? [],
  };
}

export async function detect(repl: RawRepl): Promise<BoardInfo> {
  return parseDetect(await repl.check(detectPy, 30000));
}

const py = (s: string) => JSON.stringify(s); // a JSON string is a valid Python string literal

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A file's text, or null if it doesn't exist. */
export async function readFile(repl: RawRepl, path: string): Promise<string | null> {
  const out = await repl.check(
    `import binascii\ntry:\n f=open(${py(path)},'rb')\nexcept OSError:\n print('NOFILE')\nelse:\n while True:\n  c=f.read(768)\n  if not c: break\n  print(binascii.b2a_base64(c).decode().strip())\n f.close()\n print('EOF')\n`,
    30000,
  );
  const lines = out.split(/\r?\n/).filter((l) => l.length);
  if (lines[0] === 'NOFILE') return null;
  if (lines[lines.length - 1] !== 'EOF') throw new ReplError(`reading ${path} was cut short`);
  const parts = lines.slice(0, -1).map(fromBase64);
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return new TextDecoder().decode(all);
}

const CHUNK = 1536;

/**
 * Write a file: chunks go to "<path>.tmp", which is checked (size and SHA-256) and then
 * renamed over the target, so a cut-off transfer never leaves a half-written file.
 */
export async function writeFile(repl: RawRepl, path: string, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  const tmp = `${path}.tmp`;
  await repl.check(`import binascii,os\n_tdc_f=open(${py(tmp)},'wb')\n`);
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      await repl.check(`_tdc_f.write(binascii.a2b_base64(${py(toBase64(bytes.slice(i, i + CHUNK)))}))\n`);
    }
  } finally {
    await repl.check(`_tdc_f.close()\ndel _tdc_f\n`);
  }
  const out = await repl.check(
    `import hashlib,binascii\n_h=hashlib.sha256()\nwith open(${py(tmp)},'rb') as _f:\n while True:\n  _c=_f.read(1024)\n  if not _c: break\n  _h.update(_c)\nprint(binascii.hexlify(_h.digest()).decode())\ndel _h,_f,_c\n`,
    30000,
  );
  const want = await sha256Hex(bytes);
  if (out.trim() !== want) {
    await removeFile(repl, tmp);
    throw new ReplError(`writing ${path} failed: the board's copy doesn't match`);
  }
  await repl.check(`import os\ntry:\n os.remove(${py(path)})\nexcept OSError:\n pass\nos.rename(${py(tmp)},${py(path)})\n`);
}

/** Remove a file; a missing file is not an error. */
export async function removeFile(repl: RawRepl, path: string): Promise<void> {
  await repl.check(`import os\ntry:\n os.remove(${py(path)})\nexcept OSError:\n pass\n`);
}

export async function renameFile(repl: RawRepl, from: string, to: string): Promise<void> {
  await repl.check(`import os\nos.rename(${py(from)},${py(to)})\n`);
}
