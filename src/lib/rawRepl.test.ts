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
});
