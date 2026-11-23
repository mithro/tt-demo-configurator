// SPDX-License-Identifier: Apache-2.0
//
// A raw-REPL Transport over an fpgas.online serial bridge (WebSocket), for the scripts that
// run the app's board code against a real board instead of WebSerial in a browser.
import WebSocket from 'ws';
import { Transport } from '../src/lib/rawRepl';

export class WsTransport implements Transport {
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
