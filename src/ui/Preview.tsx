// SPDX-License-Identifier: Apache-2.0
// Preview without a board: each design's recorded VGA clip, and a timeline that plays
// the sequence through with each entry's duration.
import { Box, Button, Card, CardContent, Stack, Typography } from '@suid/material';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { clipUrls } from '~/lib/shuttleIndex';
import { state as s } from './state';

export function Clip(props: { shuttle: string; macro: string | undefined; note?: string }) {
  const urls = () => (props.macro ? clipUrls(props.shuttle, props.macro) : null);
  return (
    <Show
      when={urls()}
      keyed
      fallback={
        <Box sx={{ aspectRatio: '4 / 3', background: '#111', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {props.macro ? 'no preview recorded for this design' : 'nothing selected'}
        </Box>
      }
    >
      {(u) => (
        <div>
          <video
            autoplay
            muted
            loop
            playsinline
            poster={u.poster}
            style={{ width: '100%', 'aspect-ratio': '4 / 3', background: '#000', display: 'block' }}
          >
            <source src={u.webm} type="video/webm" />
            <source src={u.mp4} type="video/mp4" />
          </video>
          <Show when={props.note}>
            <Typography variant="caption">{props.note}</Typography>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function Preview() {
  const [playing, setPlaying] = createSignal(false);
  const [elapsed, setElapsed] = createSignal(0);
  const total = createMemo(() => s.seq.projects.reduce<number>((n, e) => n + Math.max(0, e.duration_ms || 0), 0));

  const shown = () => s.selected();
  const entry = () => (shown() === null ? undefined : s.seq.projects[shown()!]);
  const macro = () => {
    const e = entry();
    return e ? s.projectOf(e)?.macro : undefined;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    clearInterval(timer);
    if (!playing() || !total()) return;
    const start = Date.now() - elapsed();
    timer = setInterval(() => {
      const t = (Date.now() - start) % total();
      setElapsed(t);
      let acc = 0;
      for (const [i, e] of s.seq.projects.entries()) {
        acc += e.duration_ms;
        if (t < acc) {
          if (s.selected() !== i) s.setSelected(i);
          break;
        }
      }
    }, 100);
  });
  onCleanup(() => clearInterval(timer));

  const jump = (i: number) => {
    s.setSelected(i);
    setElapsed(s.seq.projects.slice(0, i).reduce<number>((n, e) => n + e.duration_ms, 0));
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Preview
          </Typography>
          <Button size="small" variant={playing() ? 'contained' : 'outlined'} disabled={!total()} onClick={() => setPlaying(!playing())}>
            {playing() ? 'Pause sequence' : 'Play sequence'}
          </Button>
        </Stack>
        <Show when={s.seq.projects.length} fallback={<Typography variant="body2">The sequence is empty: its designs' recorded videos play here.</Typography>}>
        <Clip
          shuttle={s.seq.shuttle}
          macro={macro()}
          note={entry()?.steps.length ? 'Recorded with the design’s own test inputs, not this entry’s steps.' : undefined}
        />
        <Typography variant="body2" sx={{ mt: 1 }}>
          {entry() ? `${s.projectOf(entry()!)?.title ?? `address ${entry()!.address}`} — ${(entry()!.duration_ms / 1000).toFixed(1)} s` : 'Select an entry to preview it.'}
        </Typography>
        </Show>
        <Show when={total()}>
          <div style={{ display: 'flex', height: '28px', 'margin-top': '8px', 'border-radius': '4px', overflow: 'hidden', position: 'relative' }}>
            <For each={s.seq.projects}>
              {(e, i) => (
                <div
                  title={`${s.projectOf(e)?.title ?? e.address}: ${(e.duration_ms / 1000).toFixed(1)} s`}
                  onClick={() => jump(i())}
                  style={{
                    flex: `${Math.max(1, e.duration_ms)} 0 0`,
                    background: i() === s.selected() ? '#544ead' : i() % 2 ? '#c9c6ea' : '#dcdaf2',
                    color: i() === s.selected() ? '#fff' : '#333',
                    'font-size': '10px',
                    overflow: 'hidden',
                    'white-space': 'nowrap',
                    padding: '6px 3px',
                    cursor: 'pointer',
                    'border-right': '1px solid #fff',
                  }}
                >
                  {s.projectOf(e)?.title ?? e.address}
                </div>
              )}
            </For>
            <Show when={playing()}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#8afbfd', left: `${(elapsed() / total()) * 100}%` }} />
            </Show>
          </div>
          <Typography variant="caption">
            One loop: {(total() / 1000).toFixed(1)} s, {s.seq.projects.length} designs
          </Typography>
        </Show>
      </CardContent>
    </Card>
  );
}
