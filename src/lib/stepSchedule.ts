// SPDX-License-Identifier: Apache-2.0
// An entry's ui_in and "steps" as a function of time, the way the firmware's StepPlayer
// plays them (src/data/demo.py): the entry starts with ui_in; "set" writes ui_in at once,
// "wait_ms" waits; when the steps run out the project is held in reset for 2 ms (ui_in keeps
// its value) and they start over. An empty list plays nothing and never resets.
import type { Entry, Step } from './demoFile';

export interface Schedule {
  /** Length of one pass in ms; 0 when there are no steps (nothing ever happens). */
  period_ms: number;
  /** The sets of one pass, by time from the start of the pass. at_ms can equal period_ms. */
  sets: { at_ms: number; ui_in: number }[];
}

export function stepSchedule(steps: Step[]): Schedule {
  let t = 0;
  const sets: Schedule['sets'] = [];
  for (const s of steps) {
    if ('set' in s) sets.push({ at_ms: t, ui_in: s.set });
    else t += s.wait_ms;
  }
  return { period_ms: steps.length ? t : 0, sets };
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
