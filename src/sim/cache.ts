// SPDX-License-Identifier: Apache-2.0
// Small caches for the simulator worker, kept apart from it so they can be tested.

/**
 * Run fn once and share its promise, unless it rejects: then the next call tries again
 * (a brief network error loading the engine shouldn't break every later design).
 */
export function onceUnlessFailed<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    if (!p) {
      const mine = fn();
      p = mine;
      mine.catch(() => {
        if (p === mine) p = null;
      });
    }
    return p;
  };
}

/** A map that keeps the max most recently used entries, passing evicted ones to onEvict. */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(
    private max: number,
    private onEvict: (key: K, value: V) => void = () => undefined,
  ) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const [k, v] = this.map.entries().next().value as [K, V];
      this.map.delete(k);
      this.onEvict(k, v);
    }
  }

  delete(key: K) {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
