// SPDX-License-Identifier: Apache-2.0
// App state: the sequence being edited, the shuttle's projects, and the connected board.
import { createMemo, createRoot, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { BoardInfo, detect } from '~/lib/board';
import { DemoFile, Entry, entryKey, formatDemo, validateDemo } from '~/lib/demoFile';
import { RawRepl, SerialTransport } from '~/lib/rawRepl';
import { indexLookup, loadShuttle, loadShuttles, Project, projectKey, ShuttleInfo } from '~/lib/shuttleIndex';

export const DEFAULT_DURATION_MS = 15_000;
export const VGA_CLOCK_HZ = 25_175_000;

export interface LogLine {
  time: string;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

function makeState() {
  const [seq, setSeq] = createStore<DemoFile>({ version: 1, shuttle: '', projects: [] });
  const [selected, setSelected] = createSignal<number | null>(null);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [projectsFor, setProjectsFor] = createSignal('');
  const [projectsError, setProjectsError] = createSignal<string | null>(null);
  const [shuttles, setShuttles] = createSignal<ShuttleInfo[]>([]);
  const [board, setBoard] = createSignal<BoardInfo | null>(null);
  const [repl, setRepl] = createSignal<RawRepl | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [boardErrors, setBoardErrors] = createSignal<string[] | null>(null);
  const [ramRunning, setRamRunning] = createSignal(false);
  /** Why the last Connect didn't get a board, for the Board panel's troubleshooting help. */
  const [connectProblem, setConnectProblem] = createSignal<'none-chosen' | 'open-failed' | 'no-repl' | null>(null);
  const [log, setLog] = createSignal<LogLine[]>([]);

  const say = (text: string, kind: LogLine['kind'] = 'info') =>
    setLog((l) => [...l.slice(-199), { time: new Date().toLocaleTimeString(), text, kind }]);

  const byKey = createMemo(() => new Map(projects().map((p) => [projectKey(p), p])));
  const projectOf = (e: Pick<Entry, 'address' | 'subtile'>) => byKey().get(String(entryKey(e)));
  const lookup = createMemo(() => (projects().length && projectsFor() === seq.shuttle ? indexLookup(projects()) : undefined));
  const errors = createMemo(() => (seq.shuttle ? validateDemo(JSON.parse(JSON.stringify(seq)), seq.shuttle, lookup()) : ['choose a shuttle']));
  const text = createMemo(() => formatDemo(seq));

  async function chooseShuttle(id: string) {
    if (id === seq.shuttle && projectsFor() === id) return;
    setSeq('shuttle', id);
    setBoardErrors(null);
    if (!id) return;
    setProjectsError(null);
    try {
      setBusy(`loading the ${id} project list`);
      const list = await loadShuttle(id);
      list.sort((a, b) => a.title.localeCompare(b.title));
      setProjects(list);
      setProjectsFor(id);
    } catch (e) {
      setProjects([]);
      setProjectsFor('');
      setProjectsError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function ensureShuttles() {
    if (shuttles().length) return;
    try {
      setShuttles(await loadShuttles());
    } catch (e) {
      say(`couldn't load the shuttle list: ${e}`, 'error');
    }
  }

  function loadFile(file: DemoFile) {
    setSeq({ version: 1, shuttle: file.shuttle, projects: file.projects.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })) })) });
    setSelected(file.projects.length ? 0 : null);
    setBoardErrors(null);
    void chooseShuttle(file.shuttle);
  }

  function addProject(p: Project) {
    const entry: Entry = {
      address: p.address,
      subtile: p.subtile,
      duration_ms: DEFAULT_DURATION_MS,
      clock_hz: p.clock_hz || VGA_CLOCK_HZ,
      ui_in: 0,
      steps: [],
    };
    setSeq('projects', (l) => [...l, entry]);
    setSelected(seq.projects.length - 1);
    setBoardErrors(null);
  }

  function updateEntry(i: number, change: Partial<Entry>) {
    setSeq('projects', i, change);
    setBoardErrors(null);
  }

  function removeEntry(i: number) {
    setSeq('projects', (l) => l.filter((_, j) => j !== i));
    const s = selected();
    if (s !== null) setSelected(seq.projects.length ? Math.min(s, seq.projects.length - 1) : null);
    setBoardErrors(null);
  }

  function moveEntry(i: number, by: number) {
    const j = i + by;
    if (j < 0 || j >= seq.projects.length) return;
    setSeq(
      'projects',
      produce((l) => {
        const [e] = l.splice(i, 1);
        l.splice(j, 0, e);
      }),
    );
    setSelected(j);
  }

  /** Run a board job with a busy message; errors go to the log, not the console. */
  async function job<T>(what: string, fn: (r: RawRepl) => Promise<T>): Promise<T | undefined> {
    const r = repl();
    if (!r) return undefined;
    setBusy(what);
    try {
      return await fn(r);
    } catch (e) {
      say(`${what}: ${(e as Error).message ?? e}`, 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function refreshBoard() {
    const info = await job('reading the board', (r) => detect(r));
    if (info) setBoard(info);
    return info;
  }

  /** Connect to a board; `anyPort` lists every serial port, for when the 2e8a filter hides it. */
  async function connect(anyPort = false) {
    if (!('serial' in navigator)) {
      say('this browser has no WebSerial: use Chrome or Edge on a desktop', 'error');
      return;
    }
    let port: SerialPort;
    try {
      // Linux Chrome takes a port's USB IDs from udev; when they're missing the vendor filter
      // hides the board, so the help offers the unfiltered list.
      port = await navigator.serial.requestPort(anyPort ? { filters: [] } : { filters: [{ usbVendorId: 0x2e8a }] });
    } catch (e) {
      if ((e as Error).name === 'SecurityError') {
        say('the browser blocked serial access on this page (a site setting or policy): allow “Serial ports” for this site', 'error');
        return;
      }
      // Chrome's chooser was closed without picking a port: either it was cancelled, or it
      // listed nothing ("No compatible devices found"); the Board panel says what to check.
      setConnectProblem('none-chosen');
      say('no board was chosen: if the list was empty, see the checks in the Board panel', 'error');
      return;
    }
    const transport = new SerialTransport(port);
    try {
      setBusy('connecting');
      try {
        await transport.open();
      } catch (e) {
        setConnectProblem('open-failed');
        say(`couldn't open the board's serial port (${(e as Error).message ?? e}): something else probably has it open, or you lack permission; see the Board panel`, 'error');
        await transport.close();
        return;
      }
      const r = new RawRepl(transport);
      try {
        await r.enter();
      } catch (e) {
        setConnectProblem('no-repl');
        say(`the board didn't answer as MicroPython (${(e as Error).message ?? e}); see the Board panel`, 'error');
        await transport.close();
        return;
      }
      setRepl(r);
      setConnectProblem(null);
      port.addEventListener('disconnect', () => dropped());
      say('connected', 'ok');
    } finally {
      setBusy(null);
    }
    const info = await refreshBoard();
    // an empty sequence follows the board's chip; a sequence being edited is left alone
    if (info?.shuttle && !info.isFpga && info.rp2350 && !seq.projects.length) await chooseShuttle(info.shuttle);
  }

  function dropped() {
    setRepl(null);
    setBoard(null);
    setRamRunning(false);
    say('the board disconnected', 'error');
  }

  async function disconnect() {
    const r = repl();
    setRepl(null);
    setBoard(null);
    setRamRunning(false);
    if (r) {
      await r.exit().catch(() => undefined);
      await r.close();
    }
  }

  return {
    seq, setSeq, selected, setSelected, projects, projectsFor, projectsError, shuttles, ensureShuttles,
    board, setBoard, repl, busy, setBusy, boardErrors, setBoardErrors, ramRunning, setRamRunning, log, say, connectProblem,
    projectOf, lookup, errors, text, chooseShuttle, loadFile, addProject, updateEntry, removeEntry, moveEntry,
    job, refreshBoard, connect, disconnect,
  };
}

export const state = createRoot(makeState);
