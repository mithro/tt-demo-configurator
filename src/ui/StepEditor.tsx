// SPDX-License-Identifier: Apache-2.0
// An entry's input script: "set ui_in" and "wait" rows, played in order and looped
// (with a project reset) when they run out.
import { Box, Button, IconButton, MenuItem, Select, Stack, Typography } from '@suid/material';
import { createMemo, For, Show } from 'solid-js';
import type { Step } from '~/lib/demoFile';
import { Bits } from './SequenceEditor';
import { uiName } from '~/lib/shuttleIndex';
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

  const ROW = { display: 'grid', 'grid-template-columns': '1.8em 4em minmax(0, 1fr) 56px', gap: '6px', 'align-items': 'center' } as const;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">
        Steps{' '}
        <span style={{ 'font-weight': 400, opacity: 0.7 }}>
          {steps().length ? `· ${steps().length} steps, ${(total() / 1000).toFixed(2)} s per pass, then the design is reset and they repeat` : '· none, so the design is just shown'}
        </span>
      </Typography>

      <Show when={steps().length}>
        <div style={{ ...ROW, 'margin-top': '6px' }}>
          <span />
          <span />
          <div style={{ display: 'grid', 'grid-template-columns': 'repeat(8, minmax(0, 1fr))', gap: '3px' }}>
            <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
              {(n) => (
                <span style={{ 'font-size': '10px', opacity: 0.6, 'text-align': 'center', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>
                  {uiName(s.projectOf(e()), n)}
                </span>
              )}
            </For>
          </div>
          <span />
        </div>
        <Box sx={{ mt: 0.5, maxHeight: '35vh', overflow: 'auto' }}>
          <For each={steps()}>
            {(st, i) => (
              <div style={{ ...ROW, padding: '2px 0' }}>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {i() + 1}
                </Typography>
                <Typography variant="body2">{'set' in st ? 'set' : 'wait'}</Typography>
                <Show
                  when={'set' in st}
                  fallback={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        value={(st as { wait_ms: number }).wait_ms}
                        onInput={(ev) => Number.isInteger(Number(ev.currentTarget.value)) && replace(i(), { wait_ms: Number(ev.currentTarget.value) })}
                        style={{ width: '6em', padding: '3px 6px', border: '1px solid #ccc', 'border-radius': '4px', font: 'inherit' }}
                      />
                      <Typography variant="body2">ms</Typography>
                    </Stack>
                  }
                >
                  <Bits dense value={(st as { set: number }).set} entry={e()} onChange={(v) => replace(i(), { set: v })} />
                </Show>
                <span style={{ 'white-space': 'nowrap' }}>
                  <IconButton size="small" title="insert a 100 ms wait before this step" onClick={() => insert(i(), { wait_ms: 100 })}>
                    +
                  </IconButton>
                  <IconButton size="small" title="delete this step" onClick={() => remove(i())}>
                    ✕
                  </IconButton>
                </span>
              </div>
            )}
          </For>
        </Box>
      </Show>

      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          Add:
        </Typography>
        <Button size="small" variant="outlined" onClick={() => setSteps([...steps(), { set: valueBefore(steps().length) }])}>
          Set inputs
        </Button>
        <Button size="small" variant="outlined" onClick={() => setSteps([...steps(), { wait_ms: 100 }])}>
          Wait
        </Button>
        <Select
          size="small"
          value=""
          displayEmpty
          sx={{ fontSize: '13px', minWidth: '11em' }}
          title="Flip the input for 100 ms, then wait 200 ms: works for buttons that idle high or low"
          onChange={(ev) => ev.target.value !== '' && addPress(Number(ev.target.value))}
        >
          <MenuItem value="">Press a button…</MenuItem>
          <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>{(n) => <MenuItem value={n}>{uiName(s.projectOf(e()), n)}</MenuItem>}</For>
        </Select>
        <span style={{ 'flex-grow': 1 }} />
        <Show when={steps().length}>
          <Button size="small" color="error" onClick={() => setSteps([])}>
            Clear steps
          </Button>
        </Show>
      </Stack>
      <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.7 }}>
        A press flips the input for 100 ms, then waits 200 ms, so it suits buttons that idle high or low.
      </Typography>
    </Box>
  );
}
