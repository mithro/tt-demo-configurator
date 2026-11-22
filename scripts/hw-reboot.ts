// SPDX-License-Identifier: Apache-2.0
// Soft-reboot a board through an fpgas.online serial bridge, so it is left running its
// normal main.py:  npx vite-node scripts/hw-reboot.ts -- ws://127.0.0.1:18709/serial
import WebSocket from 'ws';

const url = process.argv.slice(2).filter((a) => a !== '--')[0];
const ws = new WebSocket(url);
ws.on('open', () => {
  ws.send(Buffer.from([0x03, 0x03, 0x02])); // stop anything, friendly REPL
  setTimeout(() => ws.send(Buffer.from([0x04])), 300); // Ctrl-D: soft reset, runs main.py
  setTimeout(() => {
    ws.close();
    console.log('soft reset sent');
  }, 1500);
});
ws.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
