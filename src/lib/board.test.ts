// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PythonBoard, startPythonBoard } from '~/testing/pythonBoard';
import { stubTtboard } from '~/testing/stubTtboard';
import { detect, HELPER_MARKER, readFile, removeFile, writeFile } from './board';
import { RawRepl } from './rawRepl';

let board: PythonBoard;
let repl: RawRepl;
beforeAll(async () => {
  board = startPythonBoard();
  repl = new RawRepl(board.transport, async () => undefined);
  await repl.enter();
  await repl.check(stubTtboard());
});
afterAll(() => board.stop());

describe('file transfer', () => {
  it('round-trips a file larger than one chunk, byte for byte', async () => {
    const text = Array.from({ length: 900 }, (_, i) => `line ${i} — ü ✓ "quote" \\ ${'x'.repeat(i % 50)}`).join('\n');
    await writeFile(repl, '/big.txt', text);
    expect(await readFile(repl, '/big.txt')).toBe(text);
    expect(await readFile(repl, '/big.txt.tmp')).toBeNull();
  });
  it('overwrites, reads empty files, and reports missing ones as null', async () => {
    await writeFile(repl, '/a.txt', 'one');
    await writeFile(repl, '/a.txt', '');
    expect(await readFile(repl, '/a.txt')).toBe('');
    await removeFile(repl, '/a.txt');
    await removeFile(repl, '/a.txt');
    expect(await readFile(repl, '/a.txt')).toBeNull();
  });
});

describe('detect', () => {
  it('sees a stock board', async () => {
    await writeFile(repl, '/main.py', 'print("stock")\n');
    await writeFile(repl, '/config.ini', '[DEFAULT]\nlog_level = INFO\n');
    const info = await detect(repl);
    expect(info).toMatchObject({ firmware: 'stock', sdk: '3.1.1', rp2350: true, shuttle: 'ttsky25a', projects: 237, demoSetting: false, isFpga: false });
    expect(info.rom).toEqual({ shuttle: 'ttsky25a', repo: 'TinyTapeout/x', commit: 'abcd1234' });
    expect(info.demoJson).toBeNull();
  });
  it('sees the helper, demo = yes and /demo.json', async () => {
    await writeFile(repl, '/main.py', `${HELPER_MARKER}\nexec(open('/main_stock.py').read())\n`);
    await writeFile(repl, '/demo.py', '# demo\n');
    await writeFile(repl, '/demo.json', '{"version": 1}');
    await writeFile(repl, '/config.ini', '[DEFAULT]\ndemo = yes\n');
    expect(await detect(repl)).toMatchObject({ firmware: 'helper', demoSetting: true, demoJson: '{"version": 1}' });
  });
  it('sees a hand-made Shenzhen board', async () => {
    await removeFile(repl, '/demo.py');
    await writeFile(repl, '/vga_cycle.py', 'VGA_DESIGNS = []\n');
    await writeFile(repl, '/main.py', 'print(1)\nimport vga_cycle\nvga_cycle.run(tt)\n');
    expect((await detect(repl)).firmware).toBe('handmade');
  });
  it('sees the demo-mode firmware', async () => {
    await repl.check("import sys, types\nsys.modules['ttboard.demo'] = types.ModuleType('ttboard.demo')\n");
    expect((await detect(repl)).firmware).toBe('custom');
  });
});
