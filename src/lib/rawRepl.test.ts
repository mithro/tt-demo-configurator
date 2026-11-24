// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FakeTransport } from '~/testing/fakeTransport';
import { RawRepl, ReplError } from './rawRepl';

const noSleep = async () => undefined;

describe('RawRepl', () => {
  it('enters raw mode and runs code', async () => {
    const t = new FakeTransport((code) => ({ out: `ran ${code}\r\n`, err: '' }));
    const r = new RawRepl(t, noSleep);
    await r.enter();
    expect(await r.exec('print(1)')).toEqual({ out: 'ran print(1)\r\n', err: '' });
    expect(await r.check('x')).toBe('ran x\r\n');
    expect(t.written.startsWith('\r\x03\x03\x01')).toBe(true);
  });

  it('returns stderr and check() throws its last line', async () => {
    const tb = 'Traceback (most recent call last):\r\n  File "<stdin>", line 1\r\nNameError: name \'y\' isn\'t defined\r\n';
    const r = new RawRepl(new FakeTransport(() => ({ out: 'partial', err: tb })), noSleep);
    await r.enter();
    expect((await r.exec('y')).err).toBe(tb);
    await expect(r.check('y')).rejects.toThrow("NameError: name 'y' isn't defined");
  });

  it('sends long code in chunks and keeps commands in order', async () => {
    const t = new FakeTransport((code) => ({ out: String(code.length), err: '' }), 1);
    const r = new RawRepl(t, noSleep);
    await r.enter();
    const long = 'a'.repeat(3000);
    const [a, b] = await Promise.all([r.check(long), r.check('bb')]);
    expect([a, b]).toEqual(['3000', '2']);
    expect(t.commands).toEqual([long, 'bb']);
  });

  it('waits for a program that Ctrl-C stops to go quiet', async () => {
    const t = new FakeTransport((code) => ({ out: `ran ${code}`, err: '' }));
    t.chatter('tt.uo_out=12\r\n', 20, 'ctrl-c');
    const r = new RawRepl(t, noSleep);
    await r.enter();
    expect(await r.check('x')).toBe('ran x');
    expect(t.written).not.toContain('\x01\x04');
  });

  it('soft-resets a board that keeps printing after Ctrl-C (a timer or thread)', async () => {
    const t = new FakeTransport((code) => ({ out: `ran ${code}`, err: '' }));
    t.chatter('tt.uo_out=12\r\n', 20, 'soft-reset');
    const r = new RawRepl(t, noSleep);
    await r.enter();
    expect(t.written).toContain('\x01\x04');
    expect(await r.check('x')).toBe('ran x');
  });

  it('gives up, saying why, when the board never stops printing', async () => {
    const t = new FakeTransport(() => ({ out: '', err: '' }));
    t.chatter('tt.uo_out=12\r\n', 20, 'never');
    const r = new RawRepl(t, noSleep);
    await expect(r.enter()).rejects.toThrow(/keeps printing.*tt\.uo_out=12.*Another program or browser tab/);
    await t.close();
  });

  it('drops what a running demo printed before the board took the command', async () => {
    // an FPGA board's bitstream loader prints a dozen lines on every switch, from a timer
    const t = new FakeTransport((code) => ({ out: `ran ${code}`, err: '' }));
    const r = new RawRepl(t, noSleep);
    await r.enter();
    t.beforeOk = 'ttboard.fpga.fpga_mux: Enable design tt_um_vga_pattern\r\nState machine activated\r\n';
    expect(await r.check('x')).toBe('ran x');
    expect(await r.check('y')).toBe('ran y');
  });

  it('times out on a board that never answers', async () => {
    const r = new RawRepl(new FakeTransport(() => 'hang'), noSleep);
    await r.enter();
    await expect(r.exec('while True: pass', 200)).rejects.toBeInstanceOf(ReplError);
  });

  it('reports a disconnect', async () => {
    const t = new FakeTransport(() => 'hang');
    const r = new RawRepl(t, noSleep);
    await r.enter();
    const p = r.exec('x', 5000);
    await t.close();
    await expect(p).rejects.toThrow('the board disconnected');
  });
  it('reboots from the friendly REPL and waits for main.py to finish before enter()', async () => {
    const t = new FakeTransport((code) => ({ out: `ran ${code}`, err: '' }));
    t.bootMs = 300;
    t.bootOutput = 'loading bitstream tt_um_factory_test\r\n';
    const r = new RawRepl(t, noSleep);
    await r.enter();
    const t0 = Date.now();
    expect(await r.rebootAndWait(5000)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    // Ctrl-B (friendly REPL) then Ctrl-D (soft reset, runs main.py); no Ctrl-C until after the prompt
    const after = t.written.slice(t.written.lastIndexOf('\x02'));
    expect(after).toBe('\x02\x04');
    await r.enter();
    expect(await r.check('x')).toBe('ran x');
  });

  it("says so when main.py hasn't returned in time, and still lets enter() in", async () => {
    const t = new FakeTransport((code) => ({ out: `ran ${code}`, err: '' }));
    t.bootMs = null;
    const r = new RawRepl(t, noSleep);
    await r.enter();
    expect(await r.rebootAndWait(200)).toBe(false);
    await r.enter();
    expect(await r.check('x')).toBe('ran x');
  });
});
