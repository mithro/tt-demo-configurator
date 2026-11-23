// SPDX-License-Identifier: Apache-2.0
//
// Driving a connected board: validating a sequence with the board's own demo.py, running
// one from RAM (nothing written to flash; a reset returns to normal boot), and applying
// FileOp plans.
//
// The demo module comes from the firmware when it has one (ttboard.demo), or from the
// helper's /demo.py when that is the app's current copy; otherwise the app's copy for the
// board's SDK (helperDemoPy) is sent to RAM and executed into a dict, so stock boards
// behave exactly as they will once the helper is installed.
import type { BoardInfo } from './board';
import { removeFile, writeFile } from './board';
import type { DemoFile, Entry } from './demoFile';
import type { FileOp } from './helper';
import { FPGA_DRIVE_INPUTS, helperDemoPy, helperDemoPyCurrent, helperDemoPySha256 } from './helper';
import { RawRepl, ReplError } from './rawRepl';

const SRC_CHUNK = 2048;

/** What the live functions need to know about the board. */
export type LiveBoard = Pick<BoardInfo, 'firmware' | 'mcu' | 'demoPy'>;

/**
 * The module's source cut before each top-level def or class. Each piece is a complete
 * run of statements, so the board can exec them one after another into the same dict and
 * never holds the whole source and its compiled form at once (the RP2040's heap is small).
 */
export function sourcePieces(src: string): string[] {
  const pieces: string[] = [];
  let cur: string[] = [];
  let inString: string | null = null; // the triple quote of a string still open
  let decorated = false; // the def or class being reached has its decorators in cur
  for (const line of src.split('\n')) {
    if (inString === null) {
      const isDef = /^(def|class) /.test(line);
      const isDecorator = line.startsWith('@');
      if ((isDef || isDecorator) && !decorated && cur.length) {
        pieces.push(cur.join('\n') + '\n');
        cur = [];
      }
      if (isDecorator) decorated = true;
      else if (isDef) decorated = false;
    }
    cur.push(line);
    for (const m of line.matchAll(/'''|"""/g)) {
      if (inString === null) inString = m[0];
      else if (inString === m[0]) inString = null;
    }
  }
  if (cur.length) pieces.push(cur.join('\n'));
  return pieces;
}

/** Make `_tdc_demo` on the board: a dict holding the demo module's names. */
export async function loadDemoModule(repl: RawRepl, info: LiveBoard): Promise<void> {
  if (info.firmware === 'custom') {
    await repl.check('import ttboard.demo\n_tdc_demo = ttboard.demo.__dict__\n');
    return;
  }
  // _tdc_demo_sha256 says which code _tdc_demo holds: reuse it only if it is this helper
  const want = helperDemoPySha256(info);
  const have = await repl.check("print(globals().get('_tdc_demo_sha256') if '_tdc_demo' in globals() else None)\n");
  if (have.trim() === want) return;
  await repl.check("for _n in ('_tdc_demo', '_tdc_demo_sha256'):\n globals().pop(_n, None)\n");
  if (info.firmware === 'helper' && helperDemoPyCurrent(info)) {
    // the installed helper is this same code: import it from flash rather than send it.
    // Not the module already in sys.modules: the boot wrapper imported /demo.py as it was
    // then, which may be an older helper that has been replaced since.
    await repl.check(
      `import sys\nsys.modules.pop('demo', None)\nimport demo\n_tdc_demo = demo.__dict__\n_tdc_demo_sha256 = ${JSON.stringify(want)}\n`,
      30000,
    );
    return;
  }
  // built in _tdc_part and only then named _tdc_demo, so a piece that fails (a MemoryError
  // on the RP2040's heap, a serial timeout) never leaves a half-built module behind
  try {
    await repl.check("_tdc_part = {'__name__': 'demo'}\n");
    for (const piece of sourcePieces(helperDemoPy(info))) {
      await repl.check('_tdc_src = []\n');
      for (let i = 0; i < piece.length; i += SRC_CHUNK) {
        await repl.check(`_tdc_src.append(${JSON.stringify(piece.slice(i, i + SRC_CHUNK))})\n`);
      }
      await repl.check("exec(''.join(_tdc_src), _tdc_part)\ndel _tdc_src\nimport gc\ngc.collect()\n", 30000);
    }
    await repl.check(`_tdc_demo = _tdc_part\ndel _tdc_part\n_tdc_demo_sha256 = ${JSON.stringify(want)}\n`);
  } catch (e) {
    await repl.check("for _n in ('_tdc_part', '_tdc_src'):\n globals().pop(_n, None)\nimport gc\ngc.collect()\n").catch(() => undefined);
    throw e;
  }
}

const TT = 'from ttboard.demoboard import DemoBoard\ntt = DemoBoard.get()\nimport json\n';

/** The board's verdict on a sequence: its validate() against its own project list. */
export async function boardValidate(repl: RawRepl, info: LiveBoard, text: string): Promise<string[]> {
  await loadDemoModule(repl, info);
  const out = await repl.check(
    `${TT}try:\n _c = json.loads(${JSON.stringify(text)})\nexcept ValueError as e:\n _r = ([], ['not valid JSON: %s' % e])\nelse:\n _r = _tdc_demo['validate'](_c, tt.shuttle.run, tt.shuttle)\nprint('ERRS:' + json.dumps(_r[1]))\n`,
    30000,
  );
  const line = out.split(/\r?\n/).find((l) => l.startsWith('ERRS:'));
  if (!line) throw new ReplError(`the board did not answer the check: ${out.slice(0, 200)}`);
  return JSON.parse(line.slice(5));
}

/** Stop a demo the firmware or an earlier test started. */
export async function stopDemo(repl: RawRepl): Promise<void> {
  await repl.check(`${TT}_d = getattr(tt, 'demo', None)\nif _d is not None:\n _d.stop()\n`);
}

/**
 * Run a sequence from RAM as tt.demo. Returns the board's errors (and does not start)
 * if it finds the sequence invalid.
 */
export async function runFromRam(repl: RawRepl, info: LiveBoard, file: DemoFile): Promise<string[]> {
  const text = JSON.stringify(file);
  const errors = await boardValidate(repl, info, text);
  if (errors.length) return errors;
  await stopDemo(repl);
  const out = await repl.check(
    `${TT}${FPGA_DRIVE_INPUTS}_r = _tdc_demo['validate'](json.loads(${JSON.stringify(text)}), tt.shuttle.run, tt.shuttle)\n` +
      `tt.demo = _tdc_demo['DemoRunner'](tt, _r[0], path='(configurator, RAM)')\nprint('STARTED:%s' % tt.demo.start())\n`,
    30000,
  );
  if (!out.includes('STARTED:True')) {
    const errs = await repl.check(`print(json.dumps(tt.demo.errors))\n`);
    const list: string[] = JSON.parse(errs.trim() || '[]');
    return list.length ? list : ['the board did not start the demo'];
  }
  return [];
}

/** Show one design with its idle ui_in and no steps. */
export function showOne(repl: RawRepl, info: LiveBoard, shuttle: string, entry: Entry): Promise<string[]> {
  return runFromRam(repl, info, { version: 1, shuttle, projects: [{ ...entry, steps: [] }] });
}

/** Show one design and play its steps. */
export function playOne(repl: RawRepl, info: LiveBoard, shuttle: string, entry: Entry): Promise<string[]> {
  return runFromRam(repl, info, { version: 1, shuttle, projects: [entry] });
}

/** Apply file operations in order, reporting each one. */
export async function applyOps(repl: RawRepl, ops: FileOp[], progress?: (op: FileOp, i: number) => void): Promise<void> {
  for (const [i, op] of ops.entries()) {
    progress?.(op, i);
    if (op.op === 'write') await writeFile(repl, op.path, op.text);
    else await removeFile(repl, op.path);
  }
}

/** Reboot into the board's USB bootloader (RP2040 or RP2350), for flashing a .uf2. The port goes away. */
export async function rebootToBootloader(repl: RawRepl): Promise<void> {
  await repl.exec('import machine\nmachine.bootloader()\n', 1500).catch(() => undefined);
}

/** Soft-reset the board so it boots as it will on power-up (runs main.py). */
export async function softReboot(repl: RawRepl): Promise<void> {
  // Ctrl-B to the friendly REPL, where Ctrl-D is a soft reset that runs main.py
  await repl.exit();
  await repl.softReset();
}
