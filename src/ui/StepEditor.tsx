// SPDX-License-Identifier: Apache-2.0
// An entry's input script: "set ui_in", "gamepad" and "wait" rows, played in order and
// looped (with a project reset) when they run out.
import { Box, Button, IconButton, MenuItem, Select, Stack, Typography } from '@suid/material';
import { createMemo, For, Show } from 'solid-js';
import { type Step, usesGamepad } from '~/lib/demoFile';
import { BUTTON_LABEL, GAMEPAD_BUTTONS, GAMEPAD_PINS, type GamepadButton, type GamepadController } from '~/lib/gamepad';
import { GAMEPAD_SCRIPTS, PAD_IDLE, padBefore, padPress } from '~/lib/gamepadScripts';
import { pmodsOf, uiName } from '~/lib/shuttleIndex';
import { GamepadPads } from './GamepadPads';
import { Bits, ByteField } from './SequenceEditor';
import { state as s } from './state';

export function StepEditor(props: { index: number }) {
  const e = () => s.seq.projects[props.index];
  const steps = () => e().steps;
  const pad = createMemo(() => usesGamepad(steps()));
  /** offered for designs known to read the Gamepad Pmod, and for steps that already play it */
  const padOffered = createMemo(() => {
    const p = s.projectOf(e());
    return pad() || (!!p && pmodsOf(s.seq.shuttle, p).includes('gamepad'));
  });
  const script = createMemo(() => {
    const p = s.projectOf(e());
    return p && padOffered() ? GAMEPAD_SCRIPTS[p.macro] : undefined;
  });
  /** With gamepad steps, ui_in bits 4..6 are the gamepad's: they are cleared everywhere else. */
  const setSteps = (next: Step[]) => {
    if (!usesGamepad(next)) {
      s.updateEntry(props.index, { steps: next });
      return;
    }
    const clear = (v: number) => v & ~GAMEPAD_PINS;
    s.updateEntry(props.index, { steps: next.map((st) => ('set' in st ? { set: clear(st.set) } : st)), ui_in: clear(e().ui_in) });
  };
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
  /** the controllers as the steps so far leave them; one plugged in, nothing held, before any */
  const padHeld = (): GamepadController[] => padBefore(steps(), steps().length) ?? PAD_IDLE;
  const addPadPress = (b: GamepadButton) => setSteps([...steps(), ...(padBefore(steps(), steps().length) ? [] : [{ gamepad: PAD_IDLE }]), ...padPress(padHeld(), b)]);

  const ROW = { display: 'grid', 'grid-template-columns': '1.8em 2.6em 4.5em minmax(0, 1fr) 56px', gap: '6px', 'align-items': 'center' } as const;
  const kind = (st: Step) => ('set' in st ? 'set' : 'gamepad' in st ? 'pad' : 'wait');

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
          <span style={{ 'font-size': '10px', opacity: 0.6 }}>value</span>
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
                <Typography variant="body2" title={'gamepad' in st ? 'the buttons held on the emulated Gamepad Pmod, from now until the next gamepad step' : undefined}>
                  {kind(st)}
                </Typography>
                <Show when={'set' in st}>
                  <ByteField value={(st as { set: number }).set} onChange={(v) => replace(i(), { set: v })} />
                  <Bits dense value={(st as { set: number }).set} entry={e()} onChange={(v) => replace(i(), { set: v })} locked={pad() ? GAMEPAD_PINS : 0} />
                </Show>
                <Show when={'gamepad' in st}>
                  <div style={{ 'grid-column': 'span 2', 'min-width': 0 }}>
                    <GamepadPads value={(st as { gamepad: GamepadController[] }).gamepad} onChange={(v) => replace(i(), { gamepad: v })} />
                  </div>
                </Show>
                <Show when={'wait_ms' in st}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', gridColumn: 'span 2' }}>
                    <input
                      type="number"
                      min={1}
                      value={(st as { wait_ms: number }).wait_ms}
                      onInput={(ev) => Number.isInteger(Number(ev.currentTarget.value)) && replace(i(), { wait_ms: Number(ev.currentTarget.value) })}
                      style={{ width: '6em', padding: '3px 6px', border: '1px solid #ccc', 'border-radius': '4px', font: 'inherit' }}
                    />
                    <Typography variant="body2">ms</Typography>
                  </Stack>
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
          <For each={[0, 1, 2, 3, 4, 5, 6, 7].filter((n) => !pad() || !((GAMEPAD_PINS >> n) & 1))}>{(n) => <MenuItem value={n}>{uiName(s.projectOf(e()), n)}</MenuItem>}</For>
        </Select>
        <Show when={padOffered()}>
          <Button size="small" variant="outlined" color="success" title="the buttons held on the emulated Gamepad Pmod from here on" onClick={() => setSteps([...steps(), { gamepad: padHeld() }])}>
            Gamepad
          </Button>
          <Select
            size="small"
            value=""
            displayEmpty
            sx={{ fontSize: '13px', minWidth: '12em' }}
            title="Press a player 1 button for 100 ms on top of what is held, release it, then wait 200 ms"
            onChange={(ev) => ev.target.value !== '' && addPadPress(ev.target.value as GamepadButton)}
          >
            <MenuItem value="">Press a gamepad button…</MenuItem>
            <For each={[...GAMEPAD_BUTTONS]}>{(b) => <MenuItem value={b}>{BUTTON_LABEL[b]}</MenuItem>}</For>
          </Select>
        </Show>
        <span style={{ 'flex-grow': 1 }} />
        <Show when={steps().length}>
          <Button size="small" color="error" onClick={() => setSteps([])}>
            Clear steps
          </Button>
        </Show>
      </Stack>
      <Show when={script()}>
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
          <Button
            size="small"
            variant="contained"
            color="success"
            onClick={() => {
              const n = steps().length;
              if (!n || window.confirm(`Replace this entry's ${n} steps with the example script?`)) setSteps(script()!.steps);
            }}
            title={script()!.note}
          >
            Use the example script: {script()!.title}
          </Button>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {script()!.note}
          </Typography>
        </Stack>
      </Show>
      <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.7 }}>
        A press flips the input for 100 ms, then waits 200 ms, so it suits buttons that idle high or low.
        <Show when={padOffered()}>
          {' '}
          This design reads the Gamepad Pmod: gamepad steps make the board play one, with no Pmod plugged in, on ui[4..6], which they then
          take over.
        </Show>
      </Typography>
    </Box>
  );
}
