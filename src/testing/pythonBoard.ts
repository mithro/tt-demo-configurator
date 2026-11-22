// SPDX-License-Identifier: Apache-2.0
// A FakeTransport whose commands really run in CPython (test/fake_board.py), with the
// board's "/" mapped to a fresh directory under tmp/. Used to test the Python the app
// sends to boards.
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { FakeTransport } from './fakeTransport';

const REPO = path.resolve(__dirname, '../..');

export interface PythonBoard {
  transport: FakeTransport;
  root: string;
  stop(): void;
}

export function startPythonBoard(): PythonBoard {
  mkdirSync(path.join(REPO, 'tmp'), { recursive: true });
  const root = mkdtempSync(path.join(REPO, 'tmp', 'board-'));
  const proc: ChildProcessWithoutNullStreams = spawn('uv', ['run', '--no-project', 'python', '-I', '-u', path.join(REPO, 'test/fake_board.py'), root]);
  const lines = createInterface({ input: proc.stdout });
  const waiting: ((l: string) => void)[] = [];
  lines.on('line', (l) => waiting.shift()?.(l));
  proc.stderr.on('data', (d) => process.stderr.write(d));
  const transport = new FakeTransport(
    (code) =>
      new Promise((resolve) => {
        waiting.push((l) => resolve(JSON.parse(l)));
        proc.stdin.write(JSON.stringify({ code }) + '\n');
      }),
    64,
  );
  return {
    transport,
    root,
    stop: () => {
      proc.kill();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
