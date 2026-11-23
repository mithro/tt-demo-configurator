// SPDX-License-Identifier: Apache-2.0
//
// Check the board-side Gamepad Pmod emulation on a real board, from RAM only, and measure
// how long its levels last.
//
//   npx vite-node scripts/hw-gamepad.ts -- wss://tinytapeout.fpgas.online/ws/board/fpga-4/serial
//
// It loads the app's demo.py into RAM (as "Try it" does), then:
//  1. times StepPlayer._send_report(), the code a "gamepad" step runs, 20 times;
//  2. writes one report level by level as _send_report does, timing each level, then again
//     reading the ui_in pins back after each write, and decodes the read-back levels as the
//     designs' Verilog would;
//  3. plays gamepad steps on StepPlayer's own timers for a second, through a port that reads
//     the pins back after every write, and decodes those.
// The project is not changed, enabled, clocked or reset (the steps' reset is recorded, not
// done). ui_in only reaches the pins in mode ASIC_RP_CONTROL, so a board in another mode is
// switched to it for the test (only with every ui_in DIP switch off, so nothing fights the
// pins) and switched back after; ui_in is put back too. Nothing is written to flash.
import { detect } from '../src/lib/board';
import { decodeGamepad, gamepadLevels, gamepadWord, type GamepadController } from '../src/lib/gamepad';
import { loadDemoModule } from '../src/lib/live';
import { RawRepl } from '../src/lib/rawRepl';
import { WsTransport } from './wsTransport';

let failures = 0;
function check(what: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `min ${s[0]} median ${s[s.length >> 1]} max ${s[s.length - 1]}`;
};
const lineOf = (out: string, tag: string) => {
  const l = out.split(/\r?\n/).find((x) => x.startsWith(tag));
  if (!l) throw new Error(`no ${tag} line in: ${out.slice(0, 400)}`);
  return JSON.parse(l.slice(tag.length));
};

const PADS: GamepadController[] = [{ buttons: ['b', 'start', 'up', 'a', 'r'] }, { buttons: ['left', 'x'] }];
const STEPS = [
  { gamepad: [{ buttons: ['start'] }] },
  { wait_ms: 100 },
  { gamepad: [{ buttons: ['right', 'a'] }] },
  { wait_ms: 150 },
  { gamepad: [{ buttons: [] }] },
  { wait_ms: 50 },
];

async function main() {
  const url = process.argv.slice(2).filter((a) => a !== '--')[0];
  const repl = new RawRepl(await WsTransport.open(url));
  await repl.enter();
  const info = await detect(repl);
  console.log(`board: ${info.machine} (${info.mcu}) SDK ${info.sdk} shuttle ${info.shuttle} firmware ${info.firmware} mode ${info.mode} DIP switches on ${JSON.stringify(info.dipOn)}`);
  if (!info.dipOn || info.dipOn.length) throw new Error('a ui_in DIP switch is on (or unreadable): the pins would fight it');
  await loadDemoModule(repl, info);
  const mode0 = info.mode;
  if (mode0 !== 'ASIC_RP_CONTROL') await repl.check('from ttboard.demoboard import DemoBoard\nfrom ttboard.mode import RPMode\nDemoBoard.get().mode = RPMode.ASIC_RP_CONTROL\n');
  try {
    await probe(repl);
  } finally {
    const restore = mode0 && mode0 !== 'ASIC_RP_CONTROL' ? `tt.mode = RPMode.${mode0}\n` : '';
    const out = await repl.check(`from ttboard.demoboard import DemoBoard\nfrom ttboard.mode import RPMode\ntt = DemoBoard.get()\n${restore}print('MODE:' + tt.mode_str)\n`);
    check('mode put back', out.includes(`MODE:${mode0}`), out.trim());
  }
  await repl.exit();
  await repl.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

async function probe(repl: RawRepl) {

  const TT = 'from ttboard.demoboard import DemoBoard\ntt = DemoBoard.get()\nimport json, time\nimport ttboard.util.platform as _plat\nD = _tdc_demo\n';
  const before = lineOf(
    await repl.check(`${TT}print('STATE:' + json.dumps({'ui_in': int(tt.ui_in.value), 'pins': _plat.read_ui_in_byte(), 'enabled': tt.shuttle.enabled.name if tt.shuttle.enabled else None}))\n`),
    'STATE:',
  );
  console.log(`before: ${JSON.stringify(before)}`);
  const base = before.ui_in & ~0x70;

  // 1. the real send path
  const send = lineOf(
    await repl.check(
      `${TT}_p = D['StepPlayer'](tt, [], ui_in=${base})\n_p._report = D['gamepad_levels'](D['gamepad_word'](json.loads(${JSON.stringify(JSON.stringify(PADS))})))\n` +
        "_t = []\nfor _i in range(20):\n _t0 = time.ticks_us()\n _p._send_report()\n _t.append(time.ticks_diff(time.ticks_us(), _t0))\n" +
        "print('SEND:' + json.dumps({'levels': len(_p._report), 'us': _t}))\n",
      30000,
    ),
    'SEND:',
  );
  console.log(`_send_report: ${send.levels} levels, µs per report ${stats(send.us)}; µs per level ${(send.us.reduce((a: number, b: number) => a + b, 0) / send.us.length / send.levels).toFixed(1)}`);

  // 2. level by level, read back
  const lv = lineOf(
    await repl.check(
      `${TT}_w = tt.ui_in.byte_write\n_ts = []\nfor _v in _p._report:\n _w(${base} | _v)\n _ts.append(time.ticks_us())\n_rb = []\nfor _v in _p._report:\n _w(${base} | _v)\n _rb.append(_plat.read_ui_in_byte())\n` +
        "print('LEVELS:' + json.dumps({'rb': _rb, 'dt': [time.ticks_diff(_ts[i], _ts[i - 1]) for i in range(1, len(_ts))]}))\n",
      30000,
    ),
    'LEVELS:',
  );
  const want = gamepadLevels(gamepadWord(PADS)).map((v) => base | v);
  check('the pins read back as the levels written', JSON.stringify(lv.rb) === JSON.stringify(want), `${lv.rb.length} levels`);
  check('the read-back pins decode as the buttons sent', JSON.stringify(decodeGamepad(lv.rb, before.pins)) === JSON.stringify([PADS.map((p) => p.buttons)]), JSON.stringify(decodeGamepad(lv.rb, before.pins)));
  console.log(`µs between level changes, byte_write as _send_report does (plus a ticks_us each): ${stats(lv.dt)}`);

  // 3. steps on StepPlayer's own timers
  const played = lineOf(
    await repl.check(
      `${TT}class _Rec:\n def __init__(s, port):\n  s.p = port\n  s.log = []\n @property\n def value(s):\n  return s.p.value\n @value.setter\n def value(s, v):\n  s.p.value = v\n  s.log.append((time.ticks_us(), _plat.read_ui_in_byte()))\n def byte_write(s, v):\n  s.p.byte_write(v)\n  s.log.append((time.ticks_us(), _plat.read_ui_in_byte()))\n` +
        `class _TT:\n def __init__(s):\n  s.ui_in = _Rec(tt.ui_in)\n  s.resets = []\n def reset_project(s, r):\n  s.resets.append((time.ticks_us(), r))\n` +
        `_tt = _TT()\n_sp = D['StepPlayer'](_tt, json.loads(${JSON.stringify(JSON.stringify(STEPS))}), ui_in=${base})\n_t0 = time.ticks_us()\n_sp.start()\ntime.sleep_ms(1000)\n_sp.stop()\n` +
        "print('PLAYED:' + json.dumps({'log': [(time.ticks_diff(t, _t0), v) for t, v in _tt.ui_in.log], 'resets': [(time.ticks_diff(t, _t0), r) for t, r in _tt.resets], 'passes': _sp.passes}))\n",
      30000,
    ),
    'PLAYED:',
  );
  const values: number[] = played.log.map((x: [number, number]) => x[1]);
  const reports = decodeGamepad(values, base);
  // where each report starts: the first write after a gap of more than 5 ms
  const starts = played.log.filter((x: [number, number], i: number) => i === 0 || x[0] - played.log[i - 1][0] > 5000).map((x: [number, number]) => Math.round(x[0] / 1000));
  console.log(`timers: ${played.passes} passes, resets at ${played.resets.map((r: [number, boolean]) => `${Math.round(r[0] / 1000)} ms ${r[1]}`).join(', ')}`);
  console.log(`reports start at ms ${starts.join(', ')}: ${JSON.stringify(reports)}`);
  const seq = STEPS.filter((s) => 'gamepad' in s).map((s) => (s as { gamepad: GamepadController[] }).gamepad[0].buttons);
  const expected: unknown[] = [];
  // pass 1: the three steps; after each reset: the held buttons again, then the three steps
  for (let p = 0; p <= played.passes; p++) {
    if (p) expected.push([seq[seq.length - 1], null]);
    expected.push(...seq.map((b) => [b, null]));
  }
  check('timer-played reports decode as the steps', JSON.stringify(reports) === JSON.stringify(expected.slice(0, reports.length)) && reports.length >= 3, `${reports.length} reports`);

  const after = lineOf(await repl.check(`${TT}tt.ui_in.value = ${before.ui_in}\nprint('STATE:' + json.dumps({'ui_in': int(tt.ui_in.value), 'pins': _plat.read_ui_in_byte()}))\nfor _n in ('_p', '_sp', '_tt', '_Rec', '_TT', '_w', '_ts', '_rb', '_t', '_t0', 'D'):\n globals().pop(_n, None)\n`), 'STATE:');
  check('ui_in put back', after.ui_in === before.ui_in && after.pins === before.pins, JSON.stringify(after));
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
