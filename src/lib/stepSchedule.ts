// SPDX-License-Identifier: Apache-2.0
// An entry's ui_in and "steps" as a function of time, the way the firmware's StepPlayer
// plays them (src/data/demo.py): the entry starts with ui_in; "set" writes ui_in at once,
// "wait_ms" waits; when the steps run out the project is reset (ui_in keeps its value) and
// they start over. An empty list plays nothing and never resets.
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

export interface InputsAt {
  ui_in: number;
  /** How many times the steps have run out (the project is reset each time). */
  resets: number;
}

/** ui_in and the number of resets t_ms after the entry started. */
export function inputsAt(entry: Pick<Entry, 'ui_in' | 'steps'>, t_ms: number, schedule = stepSchedule(entry.steps)): InputsAt {
  const { period_ms, sets } = schedule;
  if (!period_ms) {
    // no steps, or steps that never wait (the validator refuses those): the sets apply once
    const last = sets.length ? sets[sets.length - 1].ui_in : entry.ui_in;
    return { ui_in: last, resets: 0 };
  }
  const resets = Math.floor(Math.max(0, t_ms) / period_ms);
  const offset = Math.max(0, t_ms) - resets * period_ms;
  // what a full pass leaves behind carries into the next one
  const endOfPass = sets.length ? sets[sets.length - 1].ui_in : entry.ui_in;
  let ui_in = resets ? endOfPass : entry.ui_in;
  for (const s of sets) {
    if (s.at_ms <= offset) ui_in = s.ui_in;
    else break;
  }
  return { ui_in, resets };
}
