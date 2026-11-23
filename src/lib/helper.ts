// SPDX-License-Identifier: Apache-2.0
//
// The demo helper for stock firmware, and the file changes behind "install helper",
// "make permanent", "turn off" and "reset to stock". Planning is pure (BoardInfo in,
// FileOp list out) so it can be tested and shown to the user before anything is written.
import demoSdk2Py from '~/data/demo-sdk2.py?raw';
import demoPy from '~/data/demo.py?raw';
import stockIndex from '~/data/stock-main/index.json';
import { BoardInfo, HELPER_MARKER } from './board';
import { sha256Hex } from './sha256';

/**
 * The demo module installed as /demo.py (and sent to RAM for tests) on stock firmware:
 * the pinned firmware copy on RP2350 boards (SDK 3.x), its port to SDK 2.x on RP2040 ones.
 */
export const HELPER_DEMO_PY = { RP2350: demoPy, RP2040: demoSdk2Py } as const;
const HELPER_SHA256 = { RP2350: sha256Hex(demoPy), RP2040: sha256Hex(demoSdk2Py) } as const;

/** The helper's demo module for this board. A board of neither kind is refused before this. */
export function helperDemoPy(info: Pick<BoardInfo, 'mcu'>): string {
  return HELPER_DEMO_PY[info.mcu ?? 'RP2350'];
}

/** Is the board's /demo.py exactly the helper the app would install on it? */
export function helperDemoPyCurrent(info: Pick<BoardInfo, 'mcu' | 'demoPySha256'>): boolean {
  return info.demoPySha256 === helperDemoPySha256(info);
}

/** SHA-256 (hex) of helperDemoPy(info). */
export function helperDemoPySha256(info: Pick<BoardInfo, 'mcu'>): string {
  return HELPER_SHA256[info.mcu ?? 'RP2350'];
}

const stockFiles = import.meta.glob('../data/stock-main/*.py', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const stockByName: Record<string, string> = Object.fromEntries(
  Object.entries(stockFiles).map(([p, text]) => [p.split('/').pop()!, text]),
);

/** Every known stock main.py, newest release first. */
export const STOCK_MAINS: string[] = [...new Set(Object.values(stockIndex as Record<string, string>).reverse())].map(
  (n) => stockByName[n],
);

/** The stock main.py shipped with an SDK version, if we know it. */
export function stockMainFor(sdk: string | null): string | null {
  const name = sdk ? (stockIndex as Record<string, string>)[sdk.replace(/^v/, '')] : undefined;
  return name ? stockByName[name] : null;
}

/** Is this text exactly a released stock main.py (for that SDK, if given)? */
export function isStockMain(text: string | null, sdk?: string | null): boolean {
  if (text === null) return false;
  const exact = sdk ? stockMainFor(sdk) : null;
  return exact !== null ? text === exact : STOCK_MAINS.includes(text);
}

export const WRAPPER_MAIN = `${HELPER_MARKER}
# Runs the stock main.py, saved as /main_stock.py, then starts demo mode when
# config.ini's [DEFAULT] section says "demo = yes". The demo sequence is /demo.json,
# or the firmware's /shuttles/<shuttle>.demo.json. "Reset to stock" in the
# configurator puts the original main.py back.
exec(open('/main_stock.py').read())
try:
    import demo as _demo
    tt.demo = _demo.autostart(tt, False)
    if tt.demo.running:
        print('Demo mode running: tt.demo.stop() to stop it')
    elif tt.demo.errors:
        print('Demo mode FAILED: see tt.demo.errors')
except Exception as _e:
    # never let the demo stop the board from booting to a usable REPL
    print('Demo mode failed to start: %s' % _e)
`;

/**
 * Set config.ini's [DEFAULT] "demo" option, editing lines rather than re-serialising, so
 * comments and the user's other settings survive. null removes it. Only [DEFAULT] is
 * touched; [DEFAULT] is created at the top if missing. Commented-out lines are left alone.
 */
export function setDemoLine(ini: string | null, value: 'yes' | 'no' | null): string {
  const text = ini ?? '';
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  const isHeader = (l: string) => /^\s*\[[^\]]*\]/.test(l);
  const start = lines.findIndex((l) => /^\s*\[DEFAULT\]\s*$/.test(l));
  if (start < 0) {
    if (value === null) return text;
    const head = ['[DEFAULT]', `demo = ${value}`, ''];
    return [...head, ...lines].join(nl) + (lines.length ? '' : nl);
  }
  let end = lines.findIndex((l, i) => i > start && isHeader(l));
  if (end < 0) end = lines.length;
  const isDemo = (l: string) => /^\s*demo\s*[=:]/.test(l);
  const isCommented = (l: string) => /^\s*[#;]\s*demo\s*[=:]/.test(l);
  // 1. drop the section's active demo lines
  const section = lines.slice(start + 1, end).filter((l) => !isDemo(l));
  // 2. put the new one after a commented "# demo = ..." line if there is one, else first
  if (value !== null) {
    const at = section.findIndex(isCommented);
    section.splice(at < 0 ? 0 : at + 1, 0, `demo = ${value}`);
  }
  return [...lines.slice(0, start + 1), ...section, ...lines.slice(end)].join(nl);
}

export type FileOp = { op: 'write'; path: string; text: string; why: string } | { op: 'remove'; path: string; why: string };

/** The stock main.py hidden inside a hand-made Shenzhen main.py, if it is one. */
export function stockFromHandmade(main: string | null): string | null {
  if (main === null) return null;
  const kept = main
    .split('\n')
    .filter((l) => !/\bvga_cycle\b/.test(l) && !/^# Cycle through the VGA designs/.test(l))
    .join('\n')
    .trimEnd();
  return STOCK_MAINS.find((s) => s.trimEnd() === kept) ?? null;
}

export class PlanError extends Error {}

/** The original stock main.py of a board, wherever it is now. */
function originalMain(info: BoardInfo): string | null {
  if (info.firmware === 'helper') return info.mainStock;
  if (info.firmware === 'handmade') return stockFromHandmade(info.main);
  return info.main;
}

/**
 * Install (or refresh) the helper on stock firmware. On custom firmware there is nothing
 * to install. Refuses when the original main.py can't be kept.
 */
export function planInstallHelper(info: BoardInfo): FileOp[] {
  if (info.firmware === 'custom') return [];
  const ops: FileOp[] = [];
  if (!helperDemoPyCurrent(info)) ops.push({ op: 'write', path: '/demo.py', text: helperDemoPy(info), why: 'the demo runner' });
  if (info.firmware === 'helper') {
    if (info.main !== WRAPPER_MAIN) ops.push({ op: 'write', path: '/main.py', text: WRAPPER_MAIN, why: 'update the wrapper' });
    return ops;
  }
  const original = originalMain(info);
  if (original === null) {
    throw new PlanError(
      info.firmware === 'handmade'
        ? "this hand-made demo's main.py isn't a known stock main.py plus the vga_cycle lines"
        : 'the board has no main.py',
    );
  }
  ops.push({ op: 'write', path: '/main_stock.py', text: original, why: 'keep the original main.py' });
  ops.push({ op: 'write', path: '/main.py', text: WRAPPER_MAIN, why: 'run the stock main.py, then the demo' });
  if (info.firmware === 'handmade') ops.push({ op: 'remove', path: '/vga_cycle.py', why: 'replaced by /demo.json' });
  return ops;
}

/** Write the sequence and turn demo mode on (installing the helper first on stock firmware). */
export function planMakePermanent(info: BoardInfo, demoJson: string): FileOp[] {
  return [
    ...planInstallHelper(info),
    { op: 'write', path: '/demo.json', text: demoJson, why: 'the demo sequence' },
    { op: 'write', path: '/config.ini', text: setDemoLine(info.configIni, 'yes'), why: 'demo = yes' },
  ];
}

/** Turn demo mode off; files stay where they are. */
export function planTurnOff(info: BoardInfo): FileOp[] {
  return [{ op: 'write', path: '/config.ini', text: setDemoLine(info.configIni, 'no'), why: 'demo = no' }];
}

/** Put a board back exactly as stock: no helper, no /demo.json, no demo line. */
export function planResetToStock(info: BoardInfo): FileOp[] {
  const ops: FileOp[] = [];
  if (info.firmware === 'helper' || info.firmware === 'handmade') {
    const original = originalMain(info);
    if (original === null) throw new PlanError('the original main.py could not be found on the board');
    ops.push({ op: 'write', path: '/main.py', text: original, why: 'restore the original main.py' });
  }
  if (info.mainStock !== null) ops.push({ op: 'remove', path: '/main_stock.py', why: 'no longer needed' });
  if (info.demoPySha256 !== null) ops.push({ op: 'remove', path: '/demo.py', why: 'the helper' });
  if (info.vgaCycle !== null) ops.push({ op: 'remove', path: '/vga_cycle.py', why: 'the hand-made demo' });
  if (info.demoJson !== null) ops.push({ op: 'remove', path: '/demo.json', why: 'the demo sequence' });
  const ini = setDemoLine(info.configIni, null);
  if (info.configIni !== null && ini !== info.configIni) ops.push({ op: 'write', path: '/config.ini', text: ini, why: 'remove the demo line' });
  return ops;
}

/** Warnings to show before a reset: things that make the result not exactly stock. */
export function stockWarnings(info: BoardInfo, ops: FileOp[]): string[] {
  const main = (ops.find((o) => o.op === 'write' && o.path === '/main.py') as { text: string } | undefined)?.text ?? info.main;
  const w: string[] = [];
  if (info.firmware !== 'custom' && !isStockMain(main, info.sdk)) {
    w.push(
      stockMainFor(info.sdk)
        ? `main.py will not match the stock main.py of SDK ${info.sdk}`
        : `there is no known stock main.py for SDK ${info.sdk ?? '(unknown)'} to compare with`,
    );
  }
  return w;
}
