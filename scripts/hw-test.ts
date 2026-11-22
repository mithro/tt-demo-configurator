// SPDX-License-Identifier: Apache-2.0
//
// Run the app's own board code (src/lib) against a real board through an fpgas.online
// serial bridge (WebSocket), instead of WebSerial in a browser.
//
//   npx vite-node scripts/hw-test.ts -- ws://127.0.0.1:18709/serial <shuttle> [--permanent] [--skip=584,590]
//
// --skip leaves those addresses out of what is run (the whole file is still validated):
// for test rigs whose wiring would fight a design's outputs, like the fpgas.online Pmod HAT.
//
// Without --permanent nothing on the board's flash changes except a scratch file that is
// removed again. With --permanent it backs up main.py and config.ini, installs the helper,
// makes the bundled sequence permanent, reboots, checks the demo runs, resets to stock,
// and checks main.py and config.ini are byte-identical to the backup.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { detect, readFile, removeFile, writeFile } from '../src/lib/board';
import { formatDemo, parseDemoText } from '../src/lib/demoFile';
import { planMakePermanent, planResetToStock } from '../src/lib/helper';
import { applyOps, boardValidate, runFromRam, softReboot, stopDemo } from '../src/lib/live';
import { RawRepl, Transport } from '../src/lib/rawRepl';

class WsTransport implements Transport {
  private queue: Uint8Array[] = [];
  private waiter: ((b: Uint8Array | null) => void) | null = null;
  private closed = false;
  constructor(private ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // the bridge's JSON status events
      const b = new Uint8Array(data as Buffer);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w(b);
      } else this.queue.push(b);
    });
    ws.on('close', () => {
      this.closed = true;
      this.waiter?.(null);
    });
  }
  static open(url: string): Promise<WsTransport> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on('open', () => resolve(new WsTransport(ws)));
      ws.on('error', reject);
    });
  }
  async write(data: Uint8Array) {
    this.ws.send(data);
  }
  read(): Promise<Uint8Array | null> {
    const b = this.queue.shift();
    if (b) return Promise.resolve(b);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => (this.waiter = r));
  }
  async close() {
    this.ws.close();
  }
}

const sha = (t: string | null) => (t === null ? 'MISSING' : createHash('sha256').update(t).digest('hex').slice(0, 16));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(what: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const [url, shuttle] = args;
  const permanent = args.includes('--permanent');
  const skip = new Set((args.find((a) => a.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean).map(Number));
  const repl = new RawRepl(await WsTransport.open(url));
  await repl.enter();

  let info = await detect(repl);
  console.log(`board: ${info.machine} SDK ${info.sdk} shuttle ${info.shuttle} rom ${JSON.stringify(info.rom)} projects ${info.projects} firmware ${info.firmware} demo=${info.demoSetting} mode ${info.mode} dipOn ${JSON.stringify(info.dipOn)} errors ${JSON.stringify(info.errors)}`);
  check('detects the chip', info.shuttle === shuttle, String(info.shuttle));
  check('detects an RP2350', info.rp2350, info.machine);
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

  const text = readFileSync(path.resolve('src/data/demos', `${shuttle}.demo.json`), 'utf8');
  const { file } = parseDemoText(text, shuttle);
  const errs = await boardValidate(repl, info, formatDemo(file!));
  check('board accepts the bundled sequence', errs.length === 0, errs.join('; '));
  const bad = await boardValidate(repl, info, JSON.stringify({ ...file, projects: [{ ...file!.projects[0], address: 99999 }] }));
  check('board rejects an unknown address', bad.length === 1 && bad[0].includes('no project at address 99999'), bad.join('; '));

  const run = { ...file!, projects: file!.projects.filter((e) => !skip.has(e.address)) };
  if (skip.size) console.log(`running ${run.projects.length} of ${file!.projects.length} entries (skipping ${[...skip].join(', ')})`);
  const ram = await runFromRam(repl, info, run);
  check('runs from RAM', ram.length === 0, ram.join('; '));
  await sleep(3000);
  const running = await repl.check('print(tt.demo.running, tt.shuttle.enabled.name, tt.ui_in.value)\n');
  check('demo is running from RAM', running.trim().startsWith('True'), running.trim());
  await stopDemo(repl);

  if (permanent) {
    info = await detect(repl);
    const ops = planMakePermanent(info, formatDemo(run));
    console.log(`make permanent: ${ops.map((o) => `${o.op} ${o.path}`).join(', ')}`);
    await applyOps(repl, ops);
    info = await detect(repl);
    check('helper installed and demo on', info.firmware === (info.firmware === 'custom' ? 'custom' : 'helper') && info.demoSetting, `${info.firmware} demo=${info.demoSetting}`);

    await softReboot(repl);
    await sleep(12000);
    await repl.enter();
    info = await detect(repl);
    check('demo runs after a reboot', info.demoRunning && info.demoErrors.length === 0, `running=${info.demoRunning} errors=${info.demoErrors.join('; ')}`);
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
    await softReboot(repl);
    await sleep(12000);
    await repl.enter();
    info = await detect(repl);
    check('no demo after the final reboot', !info.demoRunning, String(info.demoRunning));
  }
  await repl.exit();
  await repl.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(2);
});
