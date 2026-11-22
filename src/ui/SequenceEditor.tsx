// SPDX-License-Identifier: Apache-2.0
// The sequence: shuttle, open/save, the entry list, and the selected entry's settings.
import { Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Select, Stack, TextField, Typography } from '@suid/material';
import { createMemo, For, onMount, Show } from 'solid-js';
import type { Entry } from '~/lib/demoFile';
import { uiName } from '~/lib/shuttleIndex';
import * as act from './actions';
import { state as s } from './state';
import { StepEditor } from './StepEditor';

const READY = import.meta.glob('../data/demos/*.demo.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const readyMade = Object.entries(READY).map(([p, text]) => ({ shuttle: p.split('/').pop()!.replace('.demo.json', ''), text }));

const CLOCKS = [0, 10_000, 1_000_000, 10_000_000, 25_000_000, 25_175_000, 25_200_000, 31_500_000, 40_000_000, 50_000_000, 50_350_000];

export function Bits(props: { value: number; onChange: (v: number) => void; entry: Entry }) {
  const p = () => s.projectOf(props.entry);
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      <For each={[7, 6, 5, 4, 3, 2, 1, 0]}>
        {(n) => {
          const on = () => ((props.value >> n) & 1) === 1;
          return (
            <button
                type="button"
                title={`ui[${n}]`}
                onClick={() => props.onChange(props.value ^ (1 << n))}
                style={{
                  border: '1px solid #544ead',
                  'border-radius': '4px',
                  padding: '2px 6px',
                  'font-size': '11px',
                  cursor: 'pointer',
                  background: on() ? '#544ead' : '#fff',
                  color: on() ? '#fff' : '#544ead',
                  'min-width': '3.2em',
                }}
              >
                {uiName(p(), n)}={on() ? 1 : 0}
              </button>
          );
        }}
      </For>
    </Stack>
  );
}

function IntField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; width?: string }) {
  return (
    <TextField
      size="small"
      label={props.label}
      type="number"
      value={props.value}
      inputProps={{ min: props.min, max: props.max }}
      sx={{ width: props.width ?? '9em' }}
      onChange={(_, v) => {
        const n = Number(v);
        if (Number.isInteger(n)) props.onChange(n);
      }}
    />
  );
}

function EntryEditor(props: { index: number }) {
  const e = () => s.seq.projects[props.index];
  const p = () => s.projectOf(e());
  const set = (change: Partial<Entry>) => s.updateEntry(props.index, change);
  return (
    <Show when={e()}>
      <Box sx={{ mt: 2 }}>
        <Typography variant="subtitle1">
          <b>{p()?.title ?? 'Unknown project'}</b> <span style={{ opacity: 0.6 }}>{p()?.macro}</span>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ my: 1, flexWrap: 'wrap', gap: 1 }}>
          <IntField label="address" value={e().address} min={0} onChange={(v) => set({ address: v })} width="7em" />
          <IntField label="subtile" value={e().subtile} min={0} onChange={(v) => set({ subtile: v })} width="6em" />
          <IntField label="duration (ms)" value={e().duration_ms} min={1} onChange={(v) => set({ duration_ms: v })} />
          <IntField label="clock (Hz)" value={e().clock_hz} min={0} onChange={(v) => set({ clock_hz: v })} width="10em" />
          <Select size="small" value="" displayEmpty onChange={(ev) => set({ clock_hz: Number(ev.target.value) })}>
            <MenuItem value="">common clocks…</MenuItem>
            <Show when={p()?.clock_hz}>
              <MenuItem value={p()!.clock_hz}>project&apos;s own: {p()!.clock_hz} Hz</MenuItem>
            </Show>
            <For each={CLOCKS}>{(c) => <MenuItem value={c}>{c === 0 ? 'stopped (0)' : `${c / 1e6} MHz`}</MenuItem>}</For>
          </Select>
        </Stack>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          ui_in at start: <b>{e().ui_in}</b> (0b{e().ui_in.toString(2).padStart(8, '0')})
        </Typography>
        <Bits value={e().ui_in} entry={e()} onChange={(v) => set({ ui_in: v })} />
        <Show when={s.board()}>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" onClick={() => act.previewEntry(props.index, false)} disabled={s.busy() !== null}>
              Show this one on the board
            </Button>
            <Button size="small" onClick={() => act.previewEntry(props.index, true)} disabled={s.busy() !== null || !e().steps.length}>
              Play its steps on the board
            </Button>
          </Stack>
        </Show>
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
                <span style={{ 'font-size': '12px', opacity: 0.8 }}>{n()} designs · Shenzhen 2026</span>
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
            <For each={readyMade}>{(r) => <MenuItem value={r.text}>{r.shuttle} (Shenzhen 2026)</MenuItem>}</For>
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
