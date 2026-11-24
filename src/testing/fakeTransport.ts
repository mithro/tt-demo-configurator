// SPDX-License-Identifier: Apache-2.0
// A Transport that behaves like a MicroPython board's raw REPL, for tests. Each received
// command (code up to Ctrl-D) is passed to `handle`, and its {out, err} is sent back with
// the raw REPL framing, split into small chunks to exercise reassembly.
import type { Transport } from '~/lib/rawRepl';

export type Handler = (code: string) => Promise<{ out: string; err: string } | 'hang'> | { out: string; err: string } | 'hang';

const enc = new TextEncoder();
const dec = new TextDecoder();
const FRIENDLY = '\r\nMicroPython v1.24.0 on 2026-01-01; Raspberry Pi Pico2 with RP2350\r\nType "help()" for more information.\r\n>>> ';

export class FakeTransport implements Transport {
  private queue: Uint8Array[] = [];
  private waiter: ((v: Uint8Array | null) => void) | null = null;
  private code = '';
  private raw = false;
  private closed = false;
  readonly commands: string[] = [];
  written = '';

  constructor(
    private readonly handle: Handler,
    private readonly chunk = 7,
  ) {}

  private send(text: string) {
    const bytes = enc.encode(text);
    for (let i = 0; i < bytes.length; i += this.chunk) this.push(bytes.slice(i, i + this.chunk));
  }

  private push(b: Uint8Array | null) {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(b);
    } else if (b) this.queue.push(b);
  }

  async write(data: Uint8Array) {
    for (const byte of data) {
      this.written += String.fromCharCode(byte);
      if (byte === 0x01) {
        this.raw = true;
        this.code = '';
        this.send('raw REPL; CTRL-B to exit\r\n>');
      } else if (byte === 0x02) {
        this.raw = false;
        this.send(FRIENDLY);
      } else if (byte === 0x04 && !this.raw) {
        // a soft reset from the friendly REPL: main.py runs, then the prompt comes back
        this.stopChatter();
        this.send('MPY: soft reboot\r\n');
        if (this.bootMs !== null) setTimeout(() => this.send(this.bootOutput + FRIENDLY), this.bootMs);
      } else if (byte === 0x03) {
        this.code = '';
        if (this.chatterStops === 'ctrl-c') this.stopChatter();
      } else if (byte === 0x04 && this.raw && this.code === '') {
        // a soft reset: MicroPython stays in raw mode and doesn't run main.py
        if (this.chatterStops !== 'never') this.stopChatter();
        this.send('OK\r\nMPY: soft reboot\r\nraw REPL; CTRL-B to exit\r\n>');
      } else if (byte === 0x04 && this.raw) {
        const code = this.code;
        this.code = '';
        this.commands.push(code);
        // what a timer callback printed while the board waited for this command
        this.send(this.beforeOk + 'OK');
        this.beforeOk = '';
        const r = await this.handle(code);
        if (r !== 'hang') this.send(`${r.out}\x04${r.err}\x04>`);
      } else if (this.raw) {
        this.code += dec.decode(new Uint8Array([byte]));
      }
    }
  }

  /** How long main.py takes after a soft reset from the friendly REPL (null: it never returns). */
  bootMs: number | null = 0;
  /** What main.py prints. */
  bootOutput = '';

  /** Text the board prints just before its next "OK", as a demo's timer callback can. */
  beforeOk = '';

  private chatterTimer: ReturnType<typeof setInterval> | undefined;
  private chatterStops: 'ctrl-c' | 'soft-reset' | 'never' = 'never';

  /** Print `text` every `everyMs`, like a running program, until Ctrl-C, a soft reset, or never. */
  chatter(text: string, everyMs: number, stops: 'ctrl-c' | 'soft-reset' | 'never') {
    this.chatterStops = stops;
    this.chatterTimer = setInterval(() => this.send(text), everyMs);
  }

  stopChatter() {
    clearInterval(this.chatterTimer);
    this.chatterTimer = undefined;
  }

  read(): Promise<Uint8Array | null> {
    const b = this.queue.shift();
    if (b) return Promise.resolve(b);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => (this.waiter = r));
  }

  async close() {
    this.stopChatter();
    this.closed = true;
    this.push(null);
  }
}
