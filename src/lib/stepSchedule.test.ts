// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { inputsAt, stepSchedule } from './stepSchedule';

describe('stepSchedule', () => {
  it('times each set from the start of a pass', () => {
    expect(stepSchedule([{ set: 6 }, { wait_ms: 40 }, { set: 7 }, { wait_ms: 250 }])).toEqual({
      period_ms: 290,
      sets: [
        { at_ms: 0, ui_in: 6 },
        { at_ms: 40, ui_in: 7 },
      ],
    });
  });
  it('has no period without steps', () => {
    expect(stepSchedule([])).toEqual({ period_ms: 0, sets: [] });
  });
  it('keeps a set after the last wait at the end of the pass', () => {
    expect(stepSchedule([{ wait_ms: 100 }, { set: 1 }]).sets).toEqual([{ at_ms: 100, ui_in: 1 }]);
  });
});

describe('inputsAt', () => {
  const entry = { ui_in: 3, steps: [{ set: 6 }, { wait_ms: 40 }, { set: 7 }, { wait_ms: 250 }] };

  it('starts with the leading sets applied', () => {
    expect(inputsAt(entry, 0)).toEqual({ ui_in: 6, resets: 0 });
    expect(inputsAt(entry, 39.9)).toEqual({ ui_in: 6, resets: 0 });
  });
  it('applies later sets at their time', () => {
    expect(inputsAt(entry, 40)).toEqual({ ui_in: 7, resets: 0 });
    expect(inputsAt(entry, 289)).toEqual({ ui_in: 7, resets: 0 });
  });
  it('resets and starts over when the steps run out', () => {
    expect(inputsAt(entry, 290)).toEqual({ ui_in: 6, resets: 1 });
    expect(inputsAt(entry, 290 * 3 + 50)).toEqual({ ui_in: 7, resets: 3 });
  });
  it("holds the entry's ui_in until the first set, then carries the last value across a reset", () => {
    const e = { ui_in: 9, steps: [{ wait_ms: 100 }, { set: 1 }, { wait_ms: 100 }, { set: 2 }] };
    expect(inputsAt(e, 50)).toEqual({ ui_in: 9, resets: 0 });
    expect(inputsAt(e, 150)).toEqual({ ui_in: 1, resets: 0 });
    // the set after the last wait happens just before the reset, so the next pass starts with it
    expect(inputsAt(e, 250)).toEqual({ ui_in: 2, resets: 1 });
    expect(inputsAt(e, 350)).toEqual({ ui_in: 1, resets: 1 });
  });
  it('lets the last of several sets at one time win', () => {
    const e = { ui_in: 0, steps: [{ set: 1 }, { wait_ms: 0 }, { set: 2 }, { wait_ms: 10 }] };
    expect(inputsAt(e, 0)).toEqual({ ui_in: 2, resets: 0 });
  });
  it('never changes or resets without steps', () => {
    expect(inputsAt({ ui_in: 5, steps: [] }, 1e9)).toEqual({ ui_in: 5, resets: 0 });
  });
});
