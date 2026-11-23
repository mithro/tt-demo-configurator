// SPDX-License-Identifier: Apache-2.0
// The app's side of the simulator worker: one worker, started on first use, shared by every
// simulated preview (only one runs at a time; a newer load replaces the older one).
import type { FromWorker, ToWorker } from './protocol';

let worker: Worker | null = null;
let ready = false;
let queue: ToWorker[] = [];
/** a load the worker hasn't answered with a picture or a failure yet */
let busy = false;
let nextToken = 1;
const listeners = new Map<number, (m: FromWorker) => void>();

function start(): Worker {
  const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  ready = false;
  w.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'ready') {
      ready = true;
      for (const q of queue) w.postMessage(q);
      queue = [];
      return;
    }
    if (m.type === 'status' && (m.state === 'paused' || m.state === 'running' || m.state === 'failed')) busy = false;
    listeners.get(m.token)?.(m);
  };
  w.onerror = (ev) => {
    const msg = ev.message || 'the simulator worker failed to start';
    for (const [token, l] of listeners) l({ type: 'status', token, state: 'failed', reason: msg });
  };
  return w;
}

function send(m: ToWorker) {
  if (!worker) worker = start();
  if (ready) worker.postMessage(m);
  else queue.push(m);
}

export interface SimSession {
  token: number;
  run(run: boolean): void;
  close(): void;
}

/** Load a design; messages for it go to onMessage until the session is closed. */
export function openSim(msg: Omit<Extract<ToWorker, { type: 'load' }>, 'type' | 'token'>, onMessage: (m: FromWorker) => void): SimSession {
  const token = nextToken++;
  for (const [t, l] of listeners) l({ type: 'status', token: t, state: 'superseded' });
  listeners.clear();
  listeners.set(token, onMessage);
  // Compiling can't be interrupted inside the worker: if it is still busy with an earlier
  // design, start a fresh worker rather than wait (it loses the cache of compiled designs).
  if (worker && busy) {
    worker.terminate();
    worker = null;
    queue = [];
  }
  busy = true;
  send({ type: 'load', token, ...msg });
  return {
    token,
    run: (run) => send({ type: 'run', token, run }),
    close: () => {
      listeners.delete(token);
      // only unload if nothing newer has been loaded since
      if (token === nextToken - 1) send({ type: 'unload' });
    },
  };
}
