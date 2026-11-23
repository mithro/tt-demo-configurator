// SPDX-License-Identifier: Apache-2.0
// Messages between the app and the simulator worker.
import type { Step } from '~/lib/demoFile';

export interface SimDesign {
  macro: string;
  repo?: string;
  commit?: string;
}

export interface SimEntry {
  ui_in: number;
  steps: Step[];
  clock_hz: number;
}

export type ToWorker =
  /** Show this design with this entry's inputs, from power-on. */
  | { type: 'load'; token: number; design: SimDesign; entry: SimEntry; run: boolean }
  /** Run or hold the current design. */
  | { type: 'run'; token: number; run: boolean }
  /** Stop and forget the current design. */
  | { type: 'unload' };

/** superseded: another preview loaded a design, so this one no longer runs */
export type SimState = 'fetching' | 'compiling' | 'running' | 'paused' | 'failed' | 'superseded';

export interface SimStats {
  /** frames per wall-clock second over the last second */
  fps: number;
  /** simulated seconds per wall-clock second (1 = real time) */
  speed: number;
  /** simulated time since the entry started */
  simMs: number;
  uiIn: number;
  lineClocks: number;
  frameLines: number;
  /** line rate, Hz (31.47 kHz for 640x480@60) */
  lineHz: number;
  /** timing is 640x480@60 within 1% */
  standard: boolean;
  /** no hsync pulse for a while */
  noSync: boolean;
}

export type FromWorker =
  | { type: 'status'; token: number; state: SimState; reason?: string; note?: string }
  | { type: 'frame'; token: number; pixels: ArrayBuffer; stats: SimStats }
  | { type: 'stats'; token: number; stats: SimStats }
  /** The worker is listening. Module workers lose messages sent before this (binaryen's top-level await runs first). */
  | { type: 'ready'; token: 0 };

/** How the worker caches a design, and how the app tells designs apart. */
export const designKey = (d: SimDesign) => `${d.repo}@${d.commit}:${d.macro}`;
