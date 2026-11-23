// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { SimClient, type WorkerLike } from './client';
import type { FromWorker, ToWorker } from './protocol';

class FakeWorker implements WorkerLike {
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((ev: { data: FromWorker }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(m: FromWorker) {
    this.onmessage?.({ data: m });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = new SimClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers };
}

const design = (macro: string) => ({ macro, repo: 'https://github.com/o/r', commit: 'c0ffee' });
const entry = { ui_in: 0, steps: [], clock_hz: 25_175_000 };
const load = (client: SimClient, macro: string, seen: FromWorker[] = []) => client.open({ design: design(macro), entry, run: true }, (m) => seen.push(m));

describe('SimClient', () => {
  it('holds messages until the worker says it is ready', () => {
    const { client, workers } = setup();
    load(client, 'a');
    expect(workers[0].sent).toEqual([]);
    workers[0].reply({ type: 'ready', token: 0 });
    expect(workers[0].sent.map((m) => m.type)).toEqual(['load']);
  });

  it('restarts the worker when another design is asked for mid-compile', () => {
    const { client, workers } = setup();
    load(client, 'a');
    workers[0].reply({ type: 'ready', token: 0 });
    load(client, 'b');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("keeps the worker for the same design mid-compile, e.g. after a steps edit (review #3)", () => {
    const { client, workers } = setup();
    load(client, 'a');
    workers[0].reply({ type: 'ready', token: 0 });
    const s2 = load(client, 'a');
    expect(workers[0].terminated).toBe(false);
    expect(workers).toHaveLength(1);
    expect(workers[0].sent.filter((m) => m.type === 'load').map((m) => m.token)).toEqual([1, s2.token]);
  });

  it('keeps the worker once the earlier load has settled', () => {
    const { client, workers } = setup();
    const s1 = load(client, 'a');
    workers[0].reply({ type: 'ready', token: 0 });
    workers[0].reply({ type: 'status', token: s1.token, state: 'paused' });
    load(client, 'b');
    expect(workers[0].terminated).toBe(false);
  });


  it('tells an older session it was superseded, and routes messages by token', () => {
    const { client, workers } = setup();
    const seen1: FromWorker[] = [];
    const seen2: FromWorker[] = [];
    const s1 = load(client, 'a', seen1);
    workers[0].reply({ type: 'ready', token: 0 });
    workers[0].reply({ type: 'status', token: s1.token, state: 'paused' });
    const s2 = load(client, 'b', seen2);
    workers[0].reply({ type: 'status', token: s2.token, state: 'running' });
    expect(seen1.map((m) => m.type === 'status' && m.state)).toEqual(['paused', 'superseded']);
    expect(seen2.map((m) => m.type === 'status' && m.state)).toEqual(['running']);
  });
});
