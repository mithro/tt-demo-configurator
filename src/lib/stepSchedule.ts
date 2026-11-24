// SPDX-License-Identifier: Apache-2.0
// An entry's ui_in and "steps" as a function of time, the way the firmware's StepPlayer
// plays them (src/data/demo.py): the entry starts with ui_in; "set" writes ui_in at once,
// "wait_ms" waits; when the steps run out the project is held in reset for 2 ms (ui_in keeps
// its value) and they start over. An empty list plays nothing and never resets.
// "gamepad" steps send a Gamepad Pmod report at their time, and the last one is sent again
// after each reset, as the board does.
import type { Entry, Step } from './demoFile';
import { gamepadWord } from './gamepad';

export interface Schedule {
  /** Length of one pass in ms; 0 when there are no steps (nothing ever happens). */
  period_ms: number;
  /** The sets of one pass, by time from the start of the pass. at_ms can equal period_ms. */
  sets: { at_ms: number; ui_in: number }[];
  /** The gamepad reports of one pass (the 24 bits sent, see gamepadWord), by time from its start. */
  pads: { at_ms: number; word: number }[];
}

export function stepSchedule(steps: Step[]): Schedule {
  let t = 0;
  const sets: Schedule['sets'] = [];
  const pads: Schedule['pads'] = [];
  for (const s of steps) {
    if ('set' in s) sets.push({ at_ms: t, ui_in: s.set });
    else if ('gamepad' in s) pads.push({ at_ms: t, word: gamepadWord(s.gamepad) });
    else t += s.wait_ms;
  }
  return { period_ms: steps.length ? t : 0, sets, pads };
}

/** The firmware holds the project in reset this long when the steps run out (sleep_ms(2)). */
export const STEP_RESET_MS = 2;

export interface InputsAt {
  ui_in: number;
  /** How many times the steps have run out (the project is reset each time). */
  resets: number;
  /** In the reset between two passes: rst_n is low. */
  inReset: boolean;
}

/**
 * ui_in, resets so far, and whether the project is held in reset, t_ms after the entry
 * started. Each pass of the steps is followed by resetMs in reset, and the next pass (its
 * leading sets included) starts when the reset is released, as on the board.
 */
export function inputsAt(entry: Pick<Entry, 'ui_in' | 'steps'>, t_ms: number, schedule = stepSchedule(entry.steps), resetMs = STEP_RESET_MS): InputsAt {
  const { period_ms, sets } = schedule;
  // what a pass leaves behind (its last set) carries into the reset and the next pass
  const endOfPass = sets.length ? sets[sets.length - 1].ui_in : entry.ui_in;
  if (!period_ms) {
    // no steps, or steps that never wait (the validator refuses those): the sets apply once
    return { ui_in: endOfPass, resets: 0, inReset: false };
  }
  const t = Math.max(0, t_ms);
  const cycle = period_ms + resetMs;
  const pass = Math.floor(t / cycle);
  const offset = t - pass * cycle;
  if (offset >= period_ms) return { ui_in: endOfPass, resets: pass + 1, inReset: true };
  let ui_in = pass ? endOfPass : entry.ui_in;
  for (const s of sets) {
    if (s.at_ms <= offset) ui_in = s.ui_in;
    else break;
  }
  return { ui_in, resets: pass, inReset: false };
}

/**
 * The gamepad reports the board starts in [fromMs, toMs) after the entry started: one at each
 * "gamepad" step, and after each reset between passes the last one again (the reset clears
 * the design's copy, and the buttons are still held), just before the next pass's steps.
 */
export function padReports(schedule: Schedule, fromMs: number, toMs: number, resetMs = STEP_RESET_MS): { at_ms: number; word: number }[] {
  const { period_ms, pads } = schedule;
  const out: { at_ms: number; word: number }[] = [];
  if (!pads.length || toMs <= fromMs) return out;
  const add = (at: number, word: number) => at >= fromMs && at < toMs && out.push({ at_ms: at, word });
  if (!period_ms) {
    // steps that never wait (the validator refuses those): one pass, never repeated
    for (const p of pads) add(p.at_ms, p.word);
    return out;
  }
  const cycle = period_ms + resetMs;
  const held = pads[pads.length - 1].word;
  for (let pass = Math.max(0, Math.floor(fromMs / cycle)); pass * cycle < toMs; pass++) {
    const base = pass * cycle;
    if (pass) add(base, held);
    for (const p of pads) add(base + p.at_ms, p.word);
  }
  return out;
}
