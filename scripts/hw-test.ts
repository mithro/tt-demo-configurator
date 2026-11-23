// SPDX-License-Identifier: Apache-2.0
//
// Run the app's own board code (src/lib) against a real board through an fpgas.online
// serial bridge (WebSocket), instead of WebSerial in a browser.
//
//   npx vite-node scripts/hw-test.ts -- ws://127.0.0.1:18709/serial <shuttle> [--permanent] [--skip=584,590]
//       [--file=path/to/sequence.demo.json] [--mcu=RP2040|RP2350]
//   npx vite-node scripts/hw-test.ts -- wss://tinytapeout.fpgas.online/ws/board/fpga-4/serial FPGA
//       --designs=tt_um_counter_7seg:10:128,tt_um_vga_pattern:25175000 [--permanent]
//
// The sequence is src/data/demos/<shuttle>.demo.json unless --file names another (there is
// no bundled one for tt04..tt07). --mcu checks the board is the kind expected.
//
// On the FPGA board (shuttle FPGA) the sequence is made from the board's own bitstreams:
// --designs lists name:clock_hz[:ui_in], 8 s each, looked up in the board's design list.
// It also checks the demo drives ui_in there (the SDK starts that board in a mode that
// doesn't), that a design sees it (when the first entry is tt_um_counter_7seg, whose
// uo_out[7] is its ui_in[7]), and that the demo switches to the next bitstream.
//
// --skip leaves those addresses out of what is run (the whole file is still validated):
// for test rigs whose wiring would fight a design's outputs, like the fpgas.online Pmod HAT.
//
// Without --permanent nothing on the board's flash changes except a scratch file that is
// removed again. With --permanent it backs up main.py and config.ini (and a SHA-256 of
// every file on the board), installs the helper, makes the sequence permanent, reboots,
// checks the demo runs, resets to stock, and checks main.py and config.ini are
// byte-identical to the backup and every file's SHA-256 is as before. If anything fails
// after the first write it still resets the board to stock before giving up.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detect, readFile, removeFile, unsupportedReason, writeFile } from '../src/lib/board';
import { DemoFile, Entry, formatDemo, parseDemoText } from '../src/lib/demoFile';
import { HELPER_DEMO_PY, planMakePermanent, planResetToStock } from '../src/lib/helper';
import { applyOps, boardValidate, runFromRam, softReboot, stopDemo } from '../src/lib/live';
import { RawRepl } from '../src/lib/rawRepl';
import { WsTransport } from './wsTransport';

const sha = (t: string | null) => (t === null ? 'MISSING' : createHash('sha256').update(t).digest('hex').slice(0, 16));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(what: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Every file on the board with its size and SHA-256, by path. */
async function manifest(repl: RawRepl): Promise<Record<string, string>> {
  const out = await repl.check(
    `import os, hashlib, binascii, json
def _tdc_walk(d):
    for e in os.ilistdir(d):
        p = d.rstrip('/') + '/' + e[0]
        if e[1] == 0x4000:
            _tdc_walk(p)
            continue
        h = hashlib.sha256()
        with open(p, 'rb') as f:
            while True:
                c = f.read(512)
                if not c:
                    break
                h.update(c)
        print('MANIFEST:' + json.dumps([p, '%d %s' % (os.stat(p)[6], binascii.hexlify(h.digest()).decode())]))
_tdc_walk('/')
del _tdc_walk
`,
    120000,
  );
  const files: Record<string, string> = {};
  for (const l of out.split(/\r?\n/)) {
    if (!l.startsWith('MANIFEST:')) continue;
    const [p, v] = JSON.parse(l.slice(9));
    files[p] = v;
  }
  return files;
}

function manifestDiff(a: Record<string, string>, b: Record<string, string>): string[] {
  const out: string[] = [];
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[p] !== b[p]) out.push(`${p}: ${a[p] ?? 'absent'} -> ${b[p] ?? 'absent'}`);
  }
  return out.sort();
}

/** A sequence of the FPGA board's own bitstreams, from --designs=name:clock_hz[:ui_in],... */
function fpgaSequence(designs: { address: number; name: string }[], spec: string): DemoFile {
  const projects = spec.split(',').map((item): Entry => {
    const [name, hz, ui] = item.split(':');
    const d = designs.find((x) => x.name === name);
    if (!d) throw new Error(`the board has no bitstream ${name}: it has ${designs.map((x) => x.name).join(', ')}`);
    return { address: d.address, subtile: 0, duration_ms: 8000, clock_hz: Number(hz), ui_in: Number(ui ?? 0), steps: [] };
  });
  return { version: 1, shuttle: 'FPGA', projects };
}

/** A line the board printed that starts with `tag`, without the tag (a demo may print around it). */
function tagged(out: string, tag: string): string {
  return (out.split(/\r?\n/).find((l) => l.startsWith(tag)) ?? '').slice(tag.length).trim();
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const [url, shuttle] = args;
  const permanent = args.includes('--permanent');
  const fileArg = args.find((a) => a.startsWith('--file='))?.slice(7);
  const designsArg = args.find((a) => a.startsWith('--designs='))?.slice(10);
  const mcuArg = args.find((a) => a.startsWith('--mcu='))?.slice(6);
  const skip = new Set((args.find((a) => a.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean).map(Number));
  const repl = new RawRepl(await WsTransport.open(url));
  await repl.enter();

  let info = await detect(repl);
  console.log(`board: ${info.machine} (${info.mcu}) SDK ${info.sdk} shuttle ${info.shuttle} rom ${JSON.stringify(info.rom)} projects ${info.projects} firmware ${info.firmware} demo=${info.demoSetting} mode ${info.mode} dipOn ${JSON.stringify(info.dipOn)} errors ${JSON.stringify(info.errors)}`);
  check('detects the chip', info.shuttle === shuttle, String(info.shuttle));
  check('detects the microcontroller', info.mcu !== null && (!mcuArg || info.mcu === mcuArg), `${info.mcu} from "${info.machine}"`);
  check('the app supports this board', unsupportedReason(info) === null, unsupportedReason(info) ?? '');
  check('reads the DIP switches', Array.isArray(info.dipOn), JSON.stringify(info.dipOn));

  const backupDir = path.resolve('tmp', `hw-backup-${shuttle}`);
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(path.join(backupDir, 'main.py'), info.main ?? '');
  writeFileSync(path.join(backupDir, 'config.ini'), info.configIni ?? '');
  console.log(`backup: main.py ${sha(info.main)} config.ini ${sha(info.configIni)} -> ${backupDir}`);

  const scratch = Array.from({ length: 400 }, (_, i) => `${i} ü ✓ ${'x'.repeat(i % 40)}`).join('\n');
  await writeFile(repl, '/tdc_scratch.txt', scratch);
  check('file round-trip', (await readFile(repl, '/tdc_scratch.txt')) === scratch);
  await removeFile(repl, '/tdc_scratch.txt');
  check('scratch file removed', (await readFile(repl, '/tdc_scratch.txt')) === null);

  let file: DemoFile | null | undefined;
  if (info.isFpga && !fileArg) {
    if (!designsArg) throw new Error('an FPGA board needs --designs=name:clock_hz[:ui_in],... (or --file)');
    console.log(`the board's designs: ${(info.fpgaDesigns ?? []).map((d) => `${d.address}=${d.name}`).join(' ')}`);
    file = fpgaSequence(info.fpgaDesigns ?? [], designsArg);
  } else {
    const text = readFileSync(fileArg ? path.resolve(fileArg) : path.resolve('src/data/demos', `${shuttle}.demo.json`), 'utf8');
    file = parseDemoText(text, shuttle).file;
  }
  console.log(`sequence: ${formatDemo(file!).replace(/\s+/g, ' ')}`);
  const errs = await boardValidate(repl, info, formatDemo(file!));
  check('board accepts the bundled sequence', errs.length === 0, errs.join('; '));
  const bad = await boardValidate(repl, info, JSON.stringify({ ...file, projects: [{ ...file!.projects[0], address: 99999 }] }));
  check('board rejects an unknown address', bad.length === 1 && bad[0].includes('no project at address 99999'), bad.join('; '));

  const run = { ...file!, projects: file!.projects.filter((e) => !skip.has(e.address)) };
  if (skip.size) console.log(`running ${run.projects.length} of ${file!.projects.length} entries (skipping ${[...skip].join(', ')})`);
  const ram = await runFromRam(repl, info, run);
  check('runs from RAM', ram.length === 0, ram.join('; '));
  await sleep(3000);
  const running = tagged(await repl.check("print('STATE', tt.demo.running, tt.shuttle.enabled.name, int(tt.ui_in.value), tt.mode_str)\n"), 'STATE');
  check('demo is running from RAM', running.startsWith('True'), running);
  if (info.isFpga) await fpgaChecks(repl, run, info.fpgaDesigns ?? []);
  await stopDemo(repl);

  if (permanent) {
    const before = await manifest(repl);
    writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(before, null, 1));
    console.log(`manifest: ${Object.keys(before).length} files -> ${path.join(backupDir, 'manifest.json')}`);
    try {
      await permanentChecks(repl, run, backupDir, before);
    } catch (e) {
      check('the permanent test ran to the end', false, String(e));
      // never leave the board changed: put it back from what is on it now
      await repl.enter();
      await stopDemo(repl).catch(() => undefined);
      const now = await detect(repl);
      await applyOps(repl, planResetToStock(now));
      const left = manifestDiff(before, await manifest(repl));
      check('the board is back to stock after the failure', left.length === 0, left.join('; '));
    }
  }
  await repl.exit();
  await repl.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

/** The FPGA board: the demo drives ui_in, a design sees it, and it switches bitstreams. */
async function fpgaChecks(repl: RawRepl, run: DemoFile, designs: { address: number; name: string }[]) {
  const name = (a: number) => designs.find((d) => d.address === a)?.name;
  const first = run.projects[0];
  const state = tagged(await repl.check("print('STATE', tt.mode_str, int(tt.ui_in.value))\n"), 'STATE');
  check('the FPGA board drives ui_in (ASIC_RP_CONTROL) with the entry’s value', state === `ASIC_RP_CONTROL ${first.ui_in}`, state);
  if (name(first.address) === 'tt_um_counter_7seg') {
    // its uo_out[7] is ui_in[7] (the pause input, shown on the decimal point)
    const sample = async () =>
      tagged(
        await repl.check("import time\n_s=[]\nfor _i in range(6):\n _s.append(int(tt.uo_out.value))\n time.sleep_ms(120)\nprint('UO', ' '.join('%02x' % v for v in _s))\n"),
        'UO',
      )
        .split(' ')
        .map((h) => parseInt(h, 16));
    for (const ui of [first.ui_in, first.ui_in ^ 0x80]) {
      await repl.check(`tt.ui_in.value = ${ui}\n`);
      const uo = await sample();
      const want = (ui >> 7) & 1;
      check(
        `tt_um_counter_7seg sees ui_in = 0x${ui.toString(16)}: uo_out[7] is ${want}`,
        uo.length === 6 && uo.every((v) => ((v >> 7) & 1) === want),
        uo.map((v) => v.toString(16)).join(' '),
      );
    }
    await repl.check(`tt.ui_in.value = ${first.ui_in}\n`);
  }
  if (run.projects.length > 1) {
    await sleep(first.duration_ms + 3000);
    const now = tagged(await repl.check("print('NOW', tt.demo.running, tt.shuttle.enabled.name)\n"), 'NOW');
    check('the demo switched to the next bitstream', now === `True ${name(run.projects[1].address)}`, now);
  }
}

async function permanentChecks(repl: RawRepl, run: DemoFile, backupDir: string, before: Record<string, string>) {
  let info = await detect(repl);
  {
    info = await detect(repl);
    const ops = planMakePermanent(info, formatDemo(run));
    console.log(`make permanent: ${ops.map((o) => `${o.op} ${o.path}`).join(', ')}`);
    await applyOps(repl, ops);
    info = await detect(repl);
    if (info.firmware !== 'custom') {
      const helper = (await readFile(repl, '/demo.py')) ?? '';
      check(`the ${info.mcu} helper is on the board`, helper === HELPER_DEMO_PY[info.mcu!], `${helper.length} bytes`);
    }
    check('helper installed and demo on', info.firmware === (info.firmware === 'custom' ? 'custom' : 'helper') && info.demoSetting, `${info.firmware} demo=${info.demoSetting}`);

    await softReboot(repl);
    await sleep(12000);
    await repl.enter();
    info = await detect(repl);
    check('demo runs after a reboot', info.demoRunning && info.demoErrors.length === 0, `running=${info.demoRunning} errors=${info.demoErrors.join('; ')}`);
    if (info.isFpga) {
      const state = tagged(await repl.check("print('STATE', tt.mode_str, tt.shuttle.enabled.name, int(tt.ui_in.value))\n"), 'STATE');
      check('after a reboot the FPGA board drives ui_in for the demo', state.startsWith('ASIC_RP_CONTROL '), state);
    }
    await stopDemo(repl);

    const reset = planResetToStock(info);
    console.log(`reset to stock: ${reset.map((o) => `${o.op} ${o.path}`).join(', ')}`);
    await applyOps(repl, reset);
    info = await detect(repl);
    const main0 = readFileSync(path.join(backupDir, 'main.py'), 'utf8');
    const ini0 = readFileSync(path.join(backupDir, 'config.ini'), 'utf8');
    check('main.py back to the original', info.main === main0, `${sha(info.main)} vs ${sha(main0)}`);
    check('config.ini back to the original', info.configIni === ini0, `${sha(info.configIni)} vs ${sha(ini0)}`);
    check('no helper files left', info.demoPy === null && info.mainStock === null && info.demoJson === null);
    check('reported as stock', info.firmware === 'stock', info.firmware);
    const changed = manifestDiff(before, await manifest(repl));
    check('every file on the board is byte-identical to before (SHA-256)', changed.length === 0, changed.join('; ') || `${Object.keys(before).length} files`);
    await softReboot(repl);
    await sleep(12000);
    await repl.enter();
    info = await detect(repl);
    check('no demo after the final reboot', !info.demoRunning, String(info.demoRunning));
    if (info.isFpga) check('the FPGA board is back in its start-up mode', info.mode === 'ASIC_MANUAL_INPUTS', String(info.mode));
  }
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
