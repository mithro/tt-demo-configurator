// SPDX-License-Identifier: Apache-2.0
// The app's side of the simulator worker: one worker, started on first use, shared by every
// simulated preview (only one runs at a time; a newer load replaces the older one).
import { designKey, type FromWorker, type ToWorker } from './protocol';

/** The parts of a Worker the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((ev: { data: FromWorker }) => void) | null;
  onerror: ((ev: { message?: string }) => void) | null;
}

export interface SimSession {
  token: number;
  run(run: boolean): void;
  close(): void;
}

export { designKey };

/** Statuses after which the worker has finished with a load (and isn't compiling for it). */
const SETTLED = new Set(['paused', 'running', 'failed']);

export class SimClient {
  private worker: WorkerLike | null = null;
  private ready = false;
  private queue: ToWorker[] = [];
  /** the load the worker hasn't settled yet: it may be compiling, which can't be interrupted */
  private busy: { token: number; key: string } | null = null;
  private nextToken = 1;
  private listeners = new Map<number, (m: FromWorker) => void>();

  constructor(private makeWorker: () => WorkerLike) {}

  private start(): WorkerLike {
    const w = this.makeWorker();
    this.ready = false;
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') {
        this.ready = true;
        for (const q of this.queue) w.postMessage(q);
        this.queue = [];
        return;
      }
      if (m.type === 'status' && SETTLED.has(m.state) && this.busy?.token === m.token) this.busy = null;
      this.listeners.get(m.token)?.(m);
    };
    w.onerror = (ev) => {
      const msg = ev.message || 'the simulator worker failed to start';
      for (const [token, l] of this.listeners) l({ type: 'status', token, state: 'failed', reason: msg });
    };
    return w;
  }

  private send(m: ToWorker) {
    if (!this.worker) this.worker = this.start();
    if (this.ready) this.worker.postMessage(m);
    else this.queue.push(m);
  }

  /** Load a design; messages for it go to onMessage until the session is closed. */
  open(msg: Omit<Extract<ToWorker, { type: 'load' }>, 'type' | 'token'>, onMessage: (m: FromWorker) => void): SimSession {
    const token = this.nextToken++;
    for (const [t, l] of this.listeners) l({ type: 'status', token: t, state: 'superseded' });
    this.listeners.clear();
    this.listeners.set(token, onMessage);
    const key = designKey(msg.design);
    // Compiling can't be interrupted inside the worker. If it is busy with a different
    // design, start a fresh worker rather than wait (losing its cache); if it is the same
    // design, the new load picks up that compile when it finishes.
    if (this.worker && this.busy && this.busy.key !== key) {
      this.worker.terminate();
      this.worker = null;
      this.queue = [];
    }
    this.busy = { token, key };
    this.send({ type: 'load', token, ...msg });
    return {
      token,
      run: (run) => this.send({ type: 'run', token, run }),
      close: () => {
        this.listeners.delete(token);
        // only unload if nothing newer has been loaded since
        if (token === this.nextToken - 1) this.send({ type: 'unload' });
      },
    };
  }

  /** for tests */
  get isBusy(): boolean {
    return this.busy !== null;
  }
}

let shared: SimClient | null = null;

/** Load a design in the shared simulator worker. */
export function openSim(msg: Parameters<SimClient['open']>[0], onMessage: (m: FromWorker) => void): SimSession {
  shared ??= new SimClient(() => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
  return shared.open(msg, onMessage);
}
