// SPDX-License-Identifier: Apache-2.0
//
// Driving a connected board: validating a sequence with the board's own demo.py, running
// one from RAM (nothing written to flash; a reset returns to normal boot), and applying
// FileOp plans.
//
// The demo module comes from the firmware when it has one (ttboard.demo), otherwise the
// app's pinned copy is sent to RAM and executed into a dict, so stock boards behave
// exactly as they will once the helper is installed.
import type { BoardInfo } from './board';
import { removeFile, writeFile } from './board';
import type { DemoFile, Entry } from './demoFile';
import type { FileOp } from './helper';
import { HELPER_DEMO_PY } from './helper';
import { RawRepl, ReplError } from './rawRepl';

const SRC_CHUNK = 2048;

/** Make `_tdc_demo` on the board: a dict holding the demo module's names. */
export async function loadDemoModule(repl: RawRepl, info: Pick<BoardInfo, 'firmware'>): Promise<void> {
  if (info.firmware === 'custom') {
    await repl.check('import ttboard.demo\n_tdc_demo = ttboard.demo.__dict__\n');
    return;
  }
  const have = await repl.check("print('_tdc_demo' in globals())\n");
  if (have.trim() === 'True') return;
  await repl.check('_tdc_src = []\n');
  for (let i = 0; i < HELPER_DEMO_PY.length; i += SRC_CHUNK) {
    await repl.check(`_tdc_src.append(${JSON.stringify(HELPER_DEMO_PY.slice(i, i + SRC_CHUNK))})\n`);
  }
  await repl.check("_tdc_demo = {'__name__': 'demo'}\nexec(''.join(_tdc_src), _tdc_demo)\ndel _tdc_src\nimport gc\ngc.collect()\n", 30000);
}

const TT = 'from ttboard.demoboard import DemoBoard\ntt = DemoBoard.get()\nimport json\n';

/** The board's verdict on a sequence: its validate() against its own project list. */
export async function boardValidate(repl: RawRepl, info: Pick<BoardInfo, 'firmware'>, text: string): Promise<string[]> {
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
export async function runFromRam(repl: RawRepl, info: Pick<BoardInfo, 'firmware'>, file: DemoFile): Promise<string[]> {
  const text = JSON.stringify(file);
  const errors = await boardValidate(repl, info, text);
  if (errors.length) return errors;
  await stopDemo(repl);
  const out = await repl.check(
    `${TT}_r = _tdc_demo['validate'](json.loads(${JSON.stringify(text)}), tt.shuttle.run, tt.shuttle)\n` +
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
export function showOne(repl: RawRepl, info: Pick<BoardInfo, 'firmware'>, shuttle: string, entry: Entry): Promise<string[]> {
  return runFromRam(repl, info, { version: 1, shuttle, projects: [{ ...entry, steps: [] }] });
}

/** Show one design and play its steps. */
export function playOne(repl: RawRepl, info: Pick<BoardInfo, 'firmware'>, shuttle: string, entry: Entry): Promise<string[]> {
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

/** Reboot into the RP2350's USB bootloader, for flashing a .uf2. The port goes away. */
export async function rebootToBootloader(repl: RawRepl): Promise<void> {
  await repl.exec('import machine\nmachine.bootloader()\n', 1500).catch(() => undefined);
}

/** Soft-reset the board so it boots as it will on power-up (runs main.py). */
export async function softReboot(repl: RawRepl): Promise<void> {
  // Ctrl-B to the friendly REPL, where Ctrl-D is a soft reset that runs main.py
  await repl.exit();
  await repl.softReset();
}
