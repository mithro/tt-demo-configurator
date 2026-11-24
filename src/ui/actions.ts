// SPDX-License-Identifier: Apache-2.0
// What the board buttons do. Every write is shown to the user first (confirmOps), and
// everything that would make a board show the error pattern is refused before writing.
import { createSignal } from 'solid-js';
import { unsupportedReason } from '~/lib/board';
import { STOCK_FIRMWARE } from '~/lib/firmware';
import { DemoFile, ENTRY_FIELDS, Entry, formatDemo, Step } from '~/lib/demoFile';
import { addressNote } from '~/lib/fpga';
import { inButtonOrder, isButton, type GamepadController } from '~/lib/gamepad';
import { importHandmade } from '~/lib/handmade';
import {
  FileOp,
  PlanError,
  planInstallHelper,
  planMakePermanent,
  planResetToStock,
  planTurnOff,
  stockWarnings,
} from '~/lib/helper';
import { applyOps, boardValidate, playOne, rebootToBootloader, runFromRam, rebootAndWait, showOne, stopDemo } from '~/lib/live';
import { loadShuttle } from '~/lib/shuttleIndex';
import { confirmOps } from './ConfirmOps';
import { state } from './state';

const s = state;

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Board set-up problems that don't stop a write but would spoil the demo. */
export function setupWarnings(): string[] {
  const b = s.board();
  if (!b) return [];
  const w: string[] = [];
  if (b.dipOn?.length) {
    w.push(
      `DIP switch${b.dipOn.length > 1 ? 'es' : ''} ${b.dipOn.map((i) => `ui_in[${i}]`).join(', ')} ${b.dipOn.length > 1 ? 'are' : 'is'} ON: ` +
        'turn all 8 ui_in DIP switches OFF, or the demo’s inputs won’t reach the designs (then reconnect to check again)',
    );
  }
  if (b.dipOn === null) w.push("couldn't read the ui_in DIP switches: check by hand that all 8 are OFF");
  // the FPGA board's SDK ignores config.ini's mode; the app's demo switches it itself
  if (b.mode && b.mode !== 'ASIC_RP_CONTROL' && !b.isFpga) {
    w.push(`the board is in ${b.mode} mode: the demo needs ASIC_RP_CONTROL to drive ui_in (set mode in config.ini)`);
  }
  if (b.isFpga && b.firmware === 'custom') {
    w.push(
      'the demo-mode firmware leaves the FPGA board in its start-up mode, where ui_in isn’t driven: after a power-up ' +
        'the designs won’t get their ui_in or steps (a test run from here does drive them)',
    );
  }
  return w;
}

/** Why the current sequence can't go onto the connected board, if it can't. */
export function blockers(): string[] {
  const b = s.board();
  if (!b) return ['no board connected'];
  const out: string[] = [];
  const unsupported = unsupportedReason(b);
  if (unsupported) return [unsupported];
  if (!b.shuttle || b.shuttle === 'unknown') out.push("the chip couldn't be identified: check it is seated properly");
  if (b.projects === 0) {
    out.push(b.isFpga ? 'this FPGA board has no bitstreams in /bitstreams' : `the firmware has no project list for ${b.shuttle}: upgrade the firmware`);
  }
  if (b.shuttle && s.seq.shuttle !== b.shuttle) out.push(`the sequence is for ${s.seq.shuttle || '(no shuttle)'} but the chip is ${b.shuttle}`);
  if (s.errors().length) out.push('the sequence has errors (see the list above the sequence)');
  return out;
}

function current(): DemoFile {
  return JSON.parse(JSON.stringify(s.seq));
}

async function checkOnBoard(): Promise<boolean> {
  const b = s.board()!;
  const errs = await s.job('checking the sequence on the board', (r) => boardValidate(r, b, formatDemo(current())));
  if (errs === undefined) return false;
  s.setBoardErrors(errs);
  if (errs.length) s.say(`the board found ${errs.length} problem(s) in the sequence`, 'error');
  return errs.length === 0;
}

/** A board is connected and the app can configure it. */
export function boardUsable(): boolean {
  const b = s.board();
  return !!b && !unsupportedReason(b);
}

/** False (and says why) when the connected board isn't one this app can configure. */
function supported(): boolean {
  const b = s.board();
  const why = b && unsupportedReason(b);
  if (why) s.say(why, 'error');
  return !!b && !why;
}

async function apply(title: string, ops: FileOp[], warnings: string[] = []): Promise<boolean> {
  if (!supported()) return false;
  if (!(await confirmOps(title, ops, warnings))) return false;
  const done = await s.job(title.toLowerCase(), async (r) => {
    await applyOps(r, ops, (op) => s.say(`${op.op === 'write' ? 'writing' : 'deleting'} ${op.path}`));
    return true;
  });
  await s.refreshBoard();
  if (done) s.say(`${title}: done`, 'ok');
  return !!done;
}

function plan(fn: () => FileOp[]): FileOp[] | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PlanError) {
      s.say(e.message, 'error');
      return null;
    }
    throw e;
  }
}

export async function testInRam() {
  const why = blockers();
  if (why.length) return s.say(`can't test: ${why.join('; ')}`, 'error');
  for (const w of setupWarnings()) s.say(w, 'error');
  const b = s.board()!;
  const r = s.repl();
  const errs = await s.job('starting the sequence from RAM', (r) => runFromRam(r, b, current()));
  if (errs === undefined) return;
  s.setBoardErrors(errs);
  if (errs.length) return s.say('the board refused the sequence', 'error');
  s.markRamRunning(r);
  s.say('running from RAM: nothing was written; Stop reboots the board back to normal', 'ok');
}

export async function previewEntry(i: number, withSteps: boolean) {
  const b = s.board();
  if (!b || !supported()) return;
  const e: Entry = JSON.parse(JSON.stringify(s.seq.projects[i]));
  const r = s.repl();
  const errs = await s.job(withSteps ? 'playing one design' : 'showing one design', (r) =>
    (withSteps ? playOne : showOne)(r, b, s.seq.shuttle, e),
  );
  if (errs?.length) {
    s.setBoardErrors(errs);
    s.say('the board refused this design', 'error');
  } else if (errs) s.markRamRunning(r);
}

export async function stop() {
  // A test from RAM changed the design, the inputs and (on the FPGA board) the input mode:
  // reboot, so the board comes up as it does on power-up. A demo the firmware started is
  // the board's normal state, so that one is only stopped.
  if (s.ramRunning()) {
    if ((await reboot()) === 'ready') s.say('test stopped: the board was rebooted into its normal state', 'ok');
    return;
  }
  await s.job('stopping the demo', (r) => stopDemo(r));
  await s.refreshBoard();
}

export async function makePermanent() {
  const why = blockers();
  if (why.length) return s.say(`can't make permanent: ${why.join('; ')}`, 'error');
  if (!(await checkOnBoard())) return;
  const b = s.board()!;
  const ops = plan(() => planMakePermanent(b, formatDemo(current())));
  if (!ops) return;
  const notes = b.fpgaDesigns ? [addressNote(current().projects, b.fpgaDesigns)] : [];
  if (await apply('Make permanent', ops, [...setupWarnings(), ...notes])) s.say('the board will run this demo every time it powers up (reboot to start it now)', 'ok');
}

export async function installHelper() {
  if (!supported()) return;
  const ops = plan(() => planInstallHelper(s.board()!));
  if (ops) await apply('Install the demo helper', ops);
}

export async function turnOff() {
  if (!supported()) return;
  await apply('Turn demo mode off', planTurnOff(s.board()!));
}

export async function resetToStock() {
  if (!supported()) return;
  const b = s.board()!;
  const ops = plan(() => planResetToStock(b));
  if (ops) await apply('Reset to stock', ops, stockWarnings(b, ops));
}

/**
 * Soft-reboot the board (main.py runs, as on power-up). 'ready': main.py returned and the app
 * is back in the REPL. 'released': main.py is still running (a hand-made board's loop never
 * returns), which is the board's normal state, so the app let go of the port rather than stop
 * it. 'failed': the reboot didn't happen as far as the app can tell.
 */
export async function reboot(): Promise<'ready' | 'released' | 'failed'> {
  const r = s.repl();
  const b = s.board();
  if (!r) return 'failed';
  const handmade = b?.firmware === 'handmade';
  const waitMs = handmade ? HANDMADE_WAIT_MS : REBOOT_TIMEOUT_MS;
  s.setBusy('rebooting');
  let returned: boolean;
  try {
    // wait for main.py to finish (the FPGA board also loads a bitstream) before Ctrl-C reaches it
    returned = await rebootAndWait(r, waitMs);
  } catch (e) {
    // the test from RAM may well still be running: ramRunning stays as it was
    s.setBusy(null);
    s.say(`reboot: ${e}`, 'error');
    return 'failed';
  }
  s.setRamRunning(false); // the soft reset has happened
  if (s.repl() !== r) {
    s.setBusy(null);
    return 'failed'; // disconnected while it booted
  }
  if (!returned) {
    s.setBusy(null);
    await s.disconnect(true);
    s.say(
      `rebooted: the board is running its own main.py, which ${handmade ? 'loops and never returns' : `hadn't finished after ${waitMs / 1000} s`}. ` +
        'The app let go of it so as not to stop it; connect again to change it (connecting stops it).',
      'ok',
    );
    return 'released';
  }
  let result: 'ready' | 'failed' = 'ready';
  try {
    await r.enter();
  } catch (e) {
    result = 'failed';
    s.say(`reboot: ${e}`, 'error');
  } finally {
    s.setBusy(null);
  }
  await s.refreshBoard();
  return result;
}

const REBOOT_TIMEOUT_MS = 30000;
/** A hand-made board's main.py loops (vga_cycle.run), so there is no prompt to wait for. */
const HANDMADE_WAIT_MS = 3000;

export async function bootloader() {
  if (!supported()) return;
  backupBoardFiles();
  const r = s.repl();
  const b = s.board();
  if (!r || !b) return;
  await rebootToBootloader(r);
  s.setRamRunning(false); // the bootloader ended the test; there is no board left to reboot
  await s.disconnect();
  s.say(`the board is now a USB drive (${b.mcu}): copy ${STOCK_FIRMWARE[b.mcu!].uf2} or another ${b.mcu} .uf2 onto it, then reconnect`, 'ok');
}

const BACKUP_KEY = 'tt-demo-configurator.backup';

/** Before flashing: keep /demo.json and config.ini (download + this browser). */
export function backupBoardFiles() {
  const b = s.board();
  if (!b) return;
  const backup = { shuttle: b.shuttle, saved: new Date().toISOString(), demo_json: b.demoJson, config_ini: b.configIni };
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  } catch {
    // storage blocked: the download still has it
  }
  setBackup(backup as Backup);
  download(`board-backup-${b.shuttle ?? 'unknown'}.json`, JSON.stringify(backup, null, 1));
  s.say('saved /demo.json and config.ini (downloaded, and kept in this browser)', 'ok');
}

type Backup = { shuttle: string; saved: string; demo_json: string | null; config_ini: string | null };

function readBackup(): Backup | null {
  try {
    const t = localStorage.getItem(BACKUP_KEY);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

const [backup, setBackup] = createSignal<Backup | null>(readBackup());
/** The files saved before a flash, if any (reactive). */
export const savedBackup = backup;

export async function restoreBackup() {
  const k = savedBackup();
  if (!k) return;
  const ops: FileOp[] = [];
  if (k.demo_json !== null) ops.push({ op: 'write', path: '/demo.json', text: k.demo_json, why: `from the backup of ${k.saved}` });
  if (k.config_ini !== null) ops.push({ op: 'write', path: '/config.ini', text: k.config_ini, why: `from the backup of ${k.saved}` });
  if (await apply('Restore the saved files', ops)) {
    try {
      localStorage.removeItem(BACKUP_KEY);
    } catch {
      // ignore
    }
    setBackup(null);
  }
}

/** A "gamepad" step's controllers as far as they make sense: at most 2, known buttons, in order. */
function looseGamepad(v: unknown): GamepadController[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 2).map((c) => {
    const buttons = c && typeof c === 'object' && Array.isArray((c as { buttons?: unknown }).buttons) ? (c as { buttons: unknown[] }).buttons : [];
    return { buttons: inButtonOrder(buttons.filter(isButton)) };
  });
}

/**
 * Open a file in the editor even if it has problems, keeping what can be kept, so the
 * user can fix it. Returns the problems found reading it.
 */
export function openText(text: string, where: string): boolean {
  let conf: unknown;
  try {
    conf = JSON.parse(text);
  } catch (e) {
    s.say(`${where}: not valid JSON: ${(e as Error).message}`, 'error');
    return false;
  }
  const c = conf as Partial<DemoFile> & Record<string, unknown>;
  if (typeof c !== 'object' || c === null || !Array.isArray(c.projects) || typeof c.shuttle !== 'string') {
    s.say(`${where}: not a demo sequence (needs "shuttle" and a "projects" list)`, 'error');
    return false;
  }
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) ? v : d);
  const raw = c.projects as unknown as Record<string, unknown>[];
  const projects: Entry[] = raw.map((p) => ({
    address: num(p?.address, 0),
    subtile: num(p?.subtile, 0),
    duration_ms: num(p?.duration_ms, 15000),
    clock_hz: num(p?.clock_hz, 0),
    ui_in: num(p?.ui_in, 0),
    steps: Array.isArray(p?.steps)
      ? (p.steps as Record<string, unknown>[])
          .filter((x) => x && ('set' in x || 'wait_ms' in x || 'gamepad' in x))
          .map((x): Step => ('set' in x ? { set: num(x.set, 0) } : 'gamepad' in x ? { gamepad: looseGamepad(x.gamepad) } : { wait_ms: num(x.wait_ms, 0) }))
      : [],
  }));
  const dropped = raw.some(
    (p) => p && Object.keys(p).some((k) => !(ENTRY_FIELDS as readonly string[]).includes(k)),
  );
  s.loadFile({ version: 1, shuttle: c.shuttle, projects });
  s.say(`opened ${where}${dropped ? ' (unknown fields were dropped)' : ''}`, 'ok');
  return true;
}

export async function importFromHandmade() {
  if (!supported()) return;
  const b = s.board();
  if (!b?.vgaCycle || !b.shuttle) return;
  let projects;
  try {
    s.setBusy(`loading the ${b.shuttle} project list`);
    projects = await loadShuttle(b.shuttle);
  } catch (e) {
    return s.say(`couldn't load the project list: ${e}`, 'error');
  } finally {
    s.setBusy(null);
  }
  try {
    const r = importHandmade(b.vgaCycle, b.shuttle, projects);
    s.loadFile(r.file);
    s.say(`imported ${r.file.projects.length} designs from /vga_cycle.py`, 'ok');
    for (const m of r.missing) s.say(`${m} is not in the ${b.shuttle} index, left out`, 'error');
    for (const n of r.needsScript) s.say(`${n.macro} had a random player (${n.player}): give it steps, or load the ready-made sequence`, 'info');
  } catch (e) {
    s.say(`couldn't read /vga_cycle.py: ${(e as Error).message}`, 'error');
  }
}
