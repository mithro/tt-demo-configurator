// SPDX-License-Identifier: Apache-2.0
// The sequence: shuttle, open/save, the entry list, and the selected entry's settings.
import { Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Select, Stack, TextField, Typography } from '@suid/material';
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { parseByte } from '~/lib/byteValue';
import { type Entry, usesGamepad } from '~/lib/demoFile';
import { GAMEPAD_PINS } from '~/lib/gamepad';
import { projectKey, uiName } from '~/lib/shuttleIndex';
import * as act from './actions';
import { state as s } from './state';
import { StepEditor } from './StepEditor';

const READY = import.meta.glob('../data/demos/*.demo.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** Where each ready-made sequence came from; the others are the Shenzhen (2026-11) booth boards. */
const ORIGIN: Record<string, string> = { tt08: 'TT08 VGA demos' };
const readyMade = Object.entries(READY).map(([p, text]) => {
  const shuttle = p.split('/').pop()!.replace('.demo.json', '');
  return { shuttle, text, origin: ORIGIN[shuttle] ?? 'Shenzhen 2026' };
});

const CLOCKS = [0, 10_000, 1_000_000, 10_000_000, 25_000_000, 25_175_000, 25_200_000, 31_500_000, 40_000_000, 50_000_000, 50_350_000];

/** Short label for input pin n: the project's own name, or "ui[n]". */
function pinLabel(entry: Entry, n: number) {
  return uiName(s.projectOf(entry), n);
}

/**
 * The 8 ui_in inputs as a row of equal cells, ui[0] on the left, each showing the pin's name
 * and its 0/1 value; click a cell to flip it. Step rows use the same grid, so columns line up.
 * Bits in `locked` (the gamepad's, when the steps play it) are shown but can't be flipped.
 */
export function Bits(props: { value: number; onChange: (v: number) => void; entry: Entry; dense?: boolean; locked?: number }) {
  return (
    <div style={{ display: 'grid', 'grid-template-columns': 'repeat(8, minmax(0, 1fr))', gap: '3px', flex: 1, 'min-width': 0 }}>
      <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
        {(n) => {
          const on = () => ((props.value >> n) & 1) === 1;
          const name = () => pinLabel(props.entry, n);
          const locked = () => ((props.locked ?? 0) >> n) & 1;
          return (
            <button
              type="button"
              disabled={!!locked()}
              title={locked() ? `ui[${n}] ${name()}: driven by the emulated Gamepad Pmod` : `ui[${n}] ${name()}: ${on() ? 1 : 0} (click to flip)`}
              onClick={() => props.onChange(props.value ^ (1 << n))}
              style={{
                opacity: locked() ? 0.4 : 1,
                border: `1px solid ${on() ? '#544ead' : '#cfcce8'}`,
                'border-radius': '4px',
                padding: props.dense ? '1px 3px' : '3px 4px',
                cursor: locked() ? 'not-allowed' : 'pointer',
                background: on() ? '#544ead' : '#fff',
                color: on() ? '#fff' : '#333',
                'min-width': 0,
                'text-align': 'center',
                'line-height': 1.2,
                font: 'inherit',
              }}
            >
              <Show when={!props.dense}>
                <div style={{ 'font-size': '10px', opacity: 0.7, overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}>{name()}</div>
              </Show>
              <div style={{ 'font-size': props.dense ? '11px' : '13px', 'font-weight': 600 }}>{locked() ? 'pad' : on() ? 1 : 0}</div>
            </button>
          );
        }}
      </For>
    </div>
  );
}

/**
 * The same 8 inputs typed as one number: decimal, 0x hex or 0b binary. It follows the toggles
 * while not being typed in; a value that isn't 0–255 is shown red and not applied.
 */
export function ByteField(props: { value: number; onChange: (v: number) => void; width?: string }) {
  const [text, setText] = createSignal(String(props.value));
  const [editing, setEditing] = createSignal(false);
  createEffect(() => {
    const v = props.value;
    if (!editing()) setText(String(v));
  });
  const bad = () => parseByte(text()) === null;
  return (
    <input
      type="text"
      inputmode="numeric"
      aria-label="ui_in as a number"
      title="ui_in as a number: decimal, 0x hex or 0b binary (0–255)"
      value={text()}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setText(String(props.value));
      }}
      onInput={(ev) => {
        setText(ev.currentTarget.value);
        const n = parseByte(ev.currentTarget.value);
        if (n !== null && n !== props.value) props.onChange(n);
      }}
      onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
      style={{
        width: props.width ?? '4.5em',
        padding: '2px 5px',
        border: `1px solid ${bad() ? '#d32f2f' : '#ccc'}`,
        'border-radius': '4px',
        font: 'inherit',
        'font-family': 'monospace',
        'box-sizing': 'border-box',
      }}
    />
  );
}

function IntField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; helper?: string; step?: number; scale?: number }) {
  const k = () => props.scale ?? 1;
  return (
    <TextField
      size="small"
      label={props.label}
      type="number"
      value={props.value / k()}
      helperText={props.helper}
      inputProps={{ min: props.min, step: props.step }}
      fullWidth
      onChange={(_, v) => {
        const n = Math.round(Number(v) * k());
        if (v !== '' && Number.isInteger(n)) props.onChange(n);
      }}
    />
  );
}

function EntryEditor(props: { index: number }) {
  const e = () => s.seq.projects[props.index];
  const p = () => s.projectOf(e());
  const set = (change: Partial<Entry>) => s.updateEntry(props.index, change);
  const mhz = (hz: number) => (hz ? `${+(hz / 1e6).toFixed(3)} MHz` : 'clock stopped');
  return (
    <Show when={e()}>
      <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #eee' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
            <b>{p()?.title ?? 'Unknown project'}</b>{' '}
            <span style={{ opacity: 0.6, 'font-size': '0.85em' }}>
              address {projectKey(e())}
              {p() ? ` · ${p()!.macro}` : ''}
            </span>
          </Typography>
          <Show when={act.boardUsable()}>
            <Button size="small" onClick={() => act.previewEntry(props.index, false)} disabled={s.busy() !== null}>
              Show on board
            </Button>
            <Button size="small" onClick={() => act.previewEntry(props.index, true)} disabled={s.busy() !== null || !e().steps.length}>
              Play steps on board
            </Button>
          </Show>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '8em minmax(9em, 14em)' }, gap: 1, mt: 1.5, alignItems: 'start' }}>
          <IntField label="Show for (s)" value={e().duration_ms} scale={1000} step={0.5} min={0.001} onChange={(v) => set({ duration_ms: v })} />
          <div>
            <IntField label="Clock (Hz)" value={e().clock_hz} min={0} onChange={(v) => set({ clock_hz: v })} />
            <Stack direction="row" sx={{ alignItems: 'center', px: 0.5 }}>
              <Typography variant="caption" sx={{ flexGrow: 1, opacity: 0.7 }}>
                {mhz(e().clock_hz)}
              </Typography>
              <Select size="small" variant="standard" disableUnderline value="" displayEmpty onChange={(ev) => set({ clock_hz: Number(ev.target.value) })} sx={{ fontSize: '12px' }}>
                <MenuItem value="">presets</MenuItem>
            <Show when={p()?.clock_hz}>
              <MenuItem value={p()!.clock_hz}>project&apos;s own ({mhz(p()!.clock_hz)})</MenuItem>
            </Show>
                <For each={CLOCKS}>{(c) => <MenuItem value={c}>{c === 0 ? 'stopped (0)' : mhz(c)}</MenuItem>}</For>
              </Select>
            </Stack>
          </div>
        </Box>

        <Stack direction="row" sx={{ alignItems: 'baseline', mt: 1.5, mb: 0.5 }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Inputs at start <span style={{ 'font-weight': 400, opacity: 0.7 }}>· click to flip, or type a number</span>
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', mr: 1 }}>
            ui_in = 0b{e().ui_in.toString(2).padStart(8, '0')}
          </Typography>
          <ByteField value={e().ui_in} onChange={(v) => set({ ui_in: v })} />
        </Stack>
        <Bits value={e().ui_in} entry={e()} onChange={(v) => set({ ui_in: v })} locked={usesGamepad(e().steps) ? GAMEPAD_PINS : 0} />

        <StepEditor index={props.index} />
      </Box>
    </Show>
  );
}

function EmptySequence() {
  const ordered = () => [...readyMade].sort((a, b) => Number(b.shuttle === s.seq.shuttle) - Number(a.shuttle === s.seq.shuttle));
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body1" gutterBottom>
        Start from a ready-made sequence, open a file, or add designs from the list on the left.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 1, mt: 1 }}>
        <For each={ordered()}>
          {(r) => {
            const n = () => (JSON.parse(r.text).projects as unknown[]).length;
            return (
              <Button
                variant={r.shuttle === s.seq.shuttle ? 'contained' : 'outlined'}
                onClick={() => act.openText(r.text, `the ready-made ${r.shuttle} sequence`)}
                sx={{ flexDirection: 'column', alignItems: 'flex-start', textTransform: 'none', p: 1.5 }}
              >
                <b>{r.shuttle}</b>
                <span style={{ 'font-size': '12px', opacity: 0.8 }}>{n()} designs · {r.origin}</span>
              </Button>
            );
          }}
        </For>
      </Box>
    </Box>
  );
}

export function SequenceEditor() {
  onMount(() => void s.ensureShuttles());
  let fileInput!: HTMLInputElement;
  const shuttleOptions = createMemo(() => {
    const ids = s.shuttles().map((x) => x.id);
    return s.seq.shuttle && !ids.includes(s.seq.shuttle) ? [s.seq.shuttle, ...ids] : ids;
  });
  const openFile = async (f: File | undefined) => {
    if (f) act.openText(await f.text(), f.name);
    fileInput.value = '';
  };
  const boardMismatch = () => {
    const b = s.board();
    return b?.shuttle && s.seq.shuttle && b.shuttle !== s.seq.shuttle ? b.shuttle : null;
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6" sx={{ whiteSpace: 'nowrap' }}>
            Sequence for
          </Typography>
          <Select size="small" value={s.seq.shuttle} displayEmpty onChange={(e) => void s.chooseShuttle(e.target.value)}>
            <MenuItem value="">choose a shuttle…</MenuItem>
            <For each={shuttleOptions()}>{(id) => <MenuItem value={id}>{id}</MenuItem>}</For>
          </Select>
          <span style={{ 'flex-grow': 1 }} />
          <Show when={s.seq.projects.length}>
            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
              {s.seq.projects.length} designs · {(s.seq.projects.reduce<number>((n, e) => n + e.duration_ms, 0) / 1000).toFixed(0)} s loop
            </Typography>
          </Show>
        </Stack>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1, pb: 1, borderBottom: '1px solid #eee' }}>
          <Select size="small" variant="standard" value="" displayEmpty sx={{ fontSize: '13px', mr: 1 }} onChange={(e) => e.target.value && act.openText(e.target.value, 'a ready-made sequence')}>
            <MenuItem value="">ready-made…</MenuItem>
            <For each={readyMade}>{(r) => <MenuItem value={r.text}>{r.shuttle} ({r.origin})</MenuItem>}</For>
          </Select>
          <Button size="small" onClick={() => fileInput.click()}>
            Open file
          </Button>
          <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => openFile(e.currentTarget.files?.[0])} />
          <Button size="small" disabled={!s.seq.shuttle || !s.seq.projects.length} onClick={() => act.download(s.seq.shuttle ? `${s.seq.shuttle}.demo.json` : 'demo.json', s.text())}>
            Download
          </Button>
          <Button
            size="small"
            color="error"
            disabled={!s.seq.projects.length}
            onClick={() => {
              s.loadFile({ version: 1, shuttle: s.seq.shuttle, projects: [] });
              s.say('cleared the sequence');
            }}
          >
            Clear
          </Button>
        </Stack>

        <Show when={boardMismatch()}>
          <Alert severity="warning" sx={{ mt: 1 }} action={<Button size="small" onClick={() => void s.chooseShuttle(boardMismatch()!)}>Switch</Button>}>
            The connected chip is {boardMismatch()}, but this sequence is for {s.seq.shuttle}.
          </Alert>
        </Show>
        <Show when={s.errors().length && s.seq.projects.length}>
          <Alert severity="error" sx={{ mt: 1 }}>
            Problems the board would refuse:
            <ul style={{ margin: 0 }}>
              <For each={s.errors().slice(0, 12)}>{(e) => <li>{e}</li>}</For>
            </ul>
            <Show when={s.errors().length > 12}>…and {s.errors().length - 12} more</Show>
          </Alert>
        </Show>
        <Show when={s.boardErrors()?.length}>
          <Alert severity="error" sx={{ mt: 1 }}>
            The board&apos;s own check:
            <ul style={{ margin: 0 }}>
              <For each={s.boardErrors()!}>{(e) => <li>{e}</li>}</For>
            </ul>
          </Alert>
        </Show>
        <Show when={s.boardErrors() && !s.boardErrors()!.length}>
          <Alert severity="success" sx={{ mt: 1 }}>
            The board checked this sequence and accepts it.
          </Alert>
        </Show>

        <Show when={s.seq.projects.length} fallback={<EmptySequence />}>
          <div style={{ 'margin-top': '8px' }}>
            <For each={s.seq.projects}>
              {(e, i) => (
                <Stack
                  direction="row"
                  spacing={1}
                  onClick={() => s.setSelected(i())}
                  sx={{ alignItems: 'center', p: 0.5, cursor: 'pointer', borderRadius: 1, background: s.selected() === i() ? '#ecebf8' : undefined }}
                >
                  <Typography variant="body2" sx={{ width: '1.8em', opacity: 0.6 }}>
                    {i() + 1}
                  </Typography>
                  <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
                    <b>{s.projectOf(e)?.title ?? `address ${e.address}`}</b>{' '}
                    <span style={{ opacity: 0.7 }}>
                      {(e.duration_ms / 1000).toFixed(1)} s · {e.clock_hz ? `${(e.clock_hz / 1e6).toFixed(3)} MHz` : 'no clock'} · ui_in {e.ui_in}
                      {e.steps.length ? ` · ${e.steps.length} steps` : ''}
                    </span>
                  </Typography>
                  <IconButton size="small" onClick={(ev) => (ev.stopPropagation(), s.moveEntry(i(), -1))} disabled={i() === 0}>
                    ↑
                  </IconButton>
                  <IconButton size="small" onClick={(ev) => (ev.stopPropagation(), s.moveEntry(i(), 1))} disabled={i() === s.seq.projects.length - 1}>
                    ↓
                  </IconButton>
                  <IconButton size="small" onClick={(ev) => (ev.stopPropagation(), s.removeEntry(i()))}>
                    ✕
                  </IconButton>
                </Stack>
              )}
            </For>
          </div>
          <Show when={s.selected() !== null}>
            <EntryEditor index={s.selected()!} />
          </Show>
        </Show>
      </CardContent>
    </Card>
  );
}
