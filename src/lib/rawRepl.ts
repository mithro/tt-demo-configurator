// SPDX-License-Identifier: Apache-2.0
//
// MicroPython's raw REPL over a byte transport (WebSerial in the browser, a fake in tests).
//
// Protocol: Ctrl-C twice stops whatever runs, Ctrl-A enters raw mode and prints
// "raw REPL; CTRL-B to exit\r\n>". Each command is the code followed by Ctrl-D; the board
// answers "OK", the command's stdout, Ctrl-D, its stderr (the traceback), Ctrl-D and ">".
// Ctrl-B returns to the friendly REPL.

export interface Transport {
  write(data: Uint8Array): Promise<void>;
  /** The next chunk of bytes, or null once the transport has closed. */
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

export class ReplError extends Error {
  constructor(
    message: string,
    readonly out = '',
    readonly err = '',
  ) {
    super(message);
    this.name = 'ReplError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const BANNER = enc.encode('raw REPL; CTRL-B to exit\r\n>');
const CTRL_A = 0x01;
const CTRL_B = 0x02;
const CTRL_C = 0x03;
const CTRL_D = 0x04;
const WRITE_CHUNK = 256;

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export class RawRepl {
  private buf = new Uint8Array(0);
  private pending: Promise<Uint8Array | null> | null = null;
  private closed = false;
  /** Serialises commands: one exec at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Called with every byte the board sends, for a debug log. */
  onData?: (text: string) => void;

  constructor(
    private readonly transport: Transport,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async fill(deadline: number): Promise<boolean> {
    if (this.closed) throw new ReplError('the board disconnected');
    if (!this.pending) this.pending = this.transport.read();
    const left = deadline - Date.now();
    if (left <= 0) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), left)));
    const got = await Promise.race([this.pending, timeout]);
    clearTimeout(timer);
    if (got === 'timeout') return false;
    this.pending = null;
    if (got === null) {
      this.closed = true;
      throw new ReplError('the board disconnected');
    }
    this.onData?.(dec.decode(got));
    this.buf = concat(this.buf, got);
    return true;
  }

  /** Bytes up to (not including) the marker; consumes the marker. */
  private async readUntil(marker: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = indexOf(this.buf, marker);
      if (i >= 0) {
        const out = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + marker.length);
        return out;
      }
      if (!(await this.fill(deadline))) {
        const seen = dec.decode(this.buf.slice(-200));
        this.buf = new Uint8Array(0);
        throw new ReplError(`timed out waiting for the board (last output: ${JSON.stringify(seen)})`);
      }
    }
  }

  private async write(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i += WRITE_CHUNK) {
      await this.transport.write(bytes.slice(i, i + WRITE_CHUNK));
      if (bytes.length > WRITE_CHUNK) await this.sleep(10);
    }
  }

  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Stop whatever is running and enter raw mode. */
  enter(timeoutMs = 5000): Promise<void> {
    return this.run(async () => {
      await this.write(new Uint8Array([0x0d, CTRL_C, CTRL_C]));
      await this.sleep(100);
      this.buf = new Uint8Array(0);
      await this.write(new Uint8Array([CTRL_A]));
      await this.readUntil(BANNER, timeoutMs);
    });
  }

  /** Run code; returns its stdout and stderr. Never throws for a Python exception. */
  exec(code: string, timeoutMs = 10000): Promise<{ out: string; err: string }> {
    return this.run(async () => {
      await this.write(enc.encode(code));
      await this.write(new Uint8Array([CTRL_D]));
      const ok = await this.readUntil(enc.encode('OK'), Math.min(timeoutMs, 5000));
      if (ok.length && dec.decode(ok).trim() !== '>' && dec.decode(ok).trim() !== '') {
        throw new ReplError(`unexpected reply from the board: ${JSON.stringify(dec.decode(ok))}`);
      }
      const out = dec.decode(await this.readUntil(new Uint8Array([CTRL_D]), timeoutMs));
      const err = dec.decode(await this.readUntil(new Uint8Array([CTRL_D]), timeoutMs));
      await this.readUntil(enc.encode('>'), 2000);
      return { out, err };
    });
  }

  /** Run code and return stdout; throws ReplError carrying the traceback on an exception. */
  async check(code: string, timeoutMs = 10000): Promise<string> {
    const { out, err } = await this.exec(code, timeoutMs);
    if (err) {
      const last = err.trim().split('\n').pop() ?? err;
      throw new ReplError(last, out, err);
    }
    return out;
  }

  /** Leave raw mode for the friendly REPL. */
  exit(): Promise<void> {
    return this.run(() => this.write(new Uint8Array([CTRL_B])));
  }

  /** Ctrl-D in raw mode: a soft reset, which runs main.py again. */
  softReset(): Promise<void> {
    return this.run(async () => {
      await this.write(new Uint8Array([CTRL_D]));
    });
  }

  close(): Promise<void> {
    this.closed = true;
    return this.transport.close();
  }
}

/** A Transport over a WebSerial port. */
export class SerialTransport implements Transport {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;

  constructor(readonly port: SerialPort) {}

  async open() {
    await this.port.open({ baudRate: 115200 });
    this.reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();
  }

  async write(data: Uint8Array) {
    await this.writer!.write(data);
  }

  async read(): Promise<Uint8Array | null> {
    try {
      const { value, done } = await this.reader!.read();
      return done || !value ? null : value;
    } catch {
      return null;
    }
  }

  async close() {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port.close();
    } catch {
      // already gone
    }
  }
}
