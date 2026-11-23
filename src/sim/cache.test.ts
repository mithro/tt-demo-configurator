// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { Lru, onceUnlessFailed } from './cache';

describe('onceUnlessFailed', () => {
  it('shares one successful result', async () => {
    let calls = 0;
    const get = onceUnlessFailed(async () => ++calls);
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    expect(calls).toBe(1);
  });

  it('tries again after a failure (review #2)', async () => {
    let calls = 0;
    const get = onceUnlessFailed(async () => {
      calls++;
      if (calls === 1) throw new Error('network');
      return 'engine';
    });
    await expect(get()).rejects.toThrow('network');
    expect(await get()).toBe('engine');
    expect(await get()).toBe('engine');
    expect(calls).toBe(2);
  });
});

describe('Lru', () => {
  it('evicts the least recently used entry (review #7)', () => {
    const evicted: string[] = [];
    const lru = new Lru<string, number>(2, (k) => evicted.push(k));
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now the most recent
    lru.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.size).toBe(2);
  });
});
