// SPDX-License-Identifier: Apache-2.0
// An entry's input script: "set ui_in" and "wait" rows, played in order and looped
// (with a project reset) when they run out.
import { Box, Button, IconButton, Stack, TextField, Typography } from '@suid/material';
import { createMemo, For, Show } from 'solid-js';
import type { Step } from '~/lib/demoFile';
import { Bits } from './SequenceEditor';
import { state as s } from './state';

export function StepEditor(props: { index: number }) {
  const e = () => s.seq.projects[props.index];
  const steps = () => e().steps;
  const setSteps = (next: Step[]) => s.updateEntry(props.index, { steps: next });
  const total = createMemo(() => steps().reduce((n, x) => n + ('wait_ms' in x ? x.wait_ms : 0), 0));
  /** the value ui_in has just before step i (a set carries on until the next set) */
  const valueBefore = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const st = steps()[j];
      if ('set' in st) return st.set;
    }
    return e().ui_in;
  };
  const replace = (i: number, st: Step) => setSteps(steps().map((x, j) => (j === i ? st : x)));
  const insert = (i: number, st: Step) => setSteps([...steps().slice(0, i), st, ...steps().slice(i)]);
  const remove = (i: number) => setSteps(steps().filter((_, j) => j !== i));
  /** a button press: hold the toggled bit for `hold` ms, release, wait `gap` ms */
  const addPress = (bit: number, hold = 100, gap = 200) => {
    const idle = steps().length ? valueBefore(steps().length) : e().ui_in;
    setSteps([...steps(), { set: idle ^ (1 << bit) }, { wait_ms: hold }, { set: idle }, { wait_ms: gap }]);
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">
        Steps{' '}
        <span style={{ 'font-weight': 400, opacity: 0.7 }}>
          {steps().length ? `${steps().length} steps, ${(total() / 1000).toFixed(2)} s per pass; then the project is reset and they start again` : 'none: the design is just shown'}
        </span>
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 1, maxHeight: '35vh', overflow: 'auto' }}>
        <For each={steps()}>
          {(st, i) => (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ width: '2em', opacity: 0.6 }}>
                {i() + 1}
              </Typography>
              <Show
                when={'set' in st}
                fallback={
                  <TextField
                    size="small"
                    type="number"
                    label="wait (ms)"
                    sx={{ width: '9em' }}
                    value={(st as { wait_ms: number }).wait_ms}
                    onChange={(_, v) => Number.isInteger(Number(v)) && replace(i(), { wait_ms: Number(v) })}
                  />
                }
              >
                <Typography variant="body2" sx={{ width: '4.5em' }}>
                  set {(st as { set: number }).set}
                </Typography>
                <Bits value={(st as { set: number }).set} entry={e()} onChange={(v) => replace(i(), { set: v })} />
              </Show>
              <span style={{ 'flex-grow': 1 }} />
              <IconButton size="small" title="insert a wait before" onClick={() => insert(i(), { wait_ms: 100 })}>
                +
              </IconButton>
              <IconButton size="small" title="delete" onClick={() => remove(i())}>
                ✕
              </IconButton>
            </Stack>
          )}
        </For>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" onClick={() => setSteps([...steps(), { set: valueBefore(steps().length) }])}>
          + set ui_in
        </Button>
        <Button size="small" onClick={() => setSteps([...steps(), { wait_ms: 100 }])}>
          + wait
        </Button>
        <Typography variant="caption" sx={{ alignSelf: 'center' }}>
          + press:
        </Typography>
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
          {(n) => (
            <Button size="small" variant="outlined" onClick={() => addPress(n)}>
              {s.projectOf(e())?.pinout[`ui[${n}]`] || `ui[${n}]`}
            </Button>
          )}
        </For>
        <Show when={steps().length}>
          <Button size="small" color="error" onClick={() => setSteps([])}>
            clear steps
          </Button>
        </Show>
      </Stack>
      <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
        A press flips that input from its current value for 100 ms, then waits 200 ms, so it suits both active-high and
        active-low buttons (set the idle value in ui_in first).
      </Typography>
    </Box>
  );
}
