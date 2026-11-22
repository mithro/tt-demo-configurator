// SPDX-License-Identifier: Apache-2.0
// Preview without a board: each design's recorded VGA clip, and a timeline that plays
// the sequence through with each entry's duration.
import { Box, Button, Card, CardContent, Stack, Typography } from '@suid/material';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from 'solid-js';
import { clipUrls, videoInfo } from '~/lib/shuttleIndex';
import { state as s } from './state';

/** What the videos project found in a design's recording, when that isn't "it moves". */
const VERDICTS: Record<string, string> = {
  static: 'This recording never changes: the design shows a still picture (with its default inputs).',
  'barely-moving': 'This recording changes only a little: most of the picture stays still.',
  blank: 'This recording is blank: the design showed nothing with its default inputs.',
  'no-sync': 'No stable VGA signal was recorded, so this clip may not match a real screen.',
  'unstable-sync': 'The VGA signal was unstable while recording, so this clip may not match a real screen.',
  'bad-timing': 'The VGA timing was unusual while recording, so this clip may not match a real screen.',
};

export function recordingNote(shuttle: string, macro: string | undefined): string | undefined {
  const v = macro ? videoInfo(shuttle, macro)?.verdict : undefined;
  return v ? VERDICTS[v] : undefined;
}

export function Clip(props: { shuttle: string; macro: string | undefined; note?: string; paused?: boolean }) {
  const urls = () => (props.macro ? clipUrls(props.shuttle, props.macro) : null);
  const [state, setState] = createSignal<'loading' | 'playing' | 'paused' | 'error'>('loading');
  const [progress, setProgress] = createSignal(0);
  const [length, setLength] = createSignal(0);
  let video: HTMLVideoElement | undefined;
  // The sequence's pause freezes the clip too; resuming plays it again.
  createEffect(() => {
    const hold = props.paused;
    if (!video) return;
    if (hold) video.pause();
    else if (video.paused && untrack(state) !== 'error') void video.play().catch(() => undefined);
  });
  const label = () =>
    ({ loading: 'loading the recording…', playing: `playing · ${length() ? `${Math.floor(progress() * length())} of ${Math.round(length())} s, looping` : ''}`, paused: 'paused (click to play)', error: "couldn't load the recording" })[state()];
  return (
    <Show
      when={urls()}
      keyed
      fallback={
        <Box sx={{ aspectRatio: '4 / 3', background: '#111', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {props.macro ? 'no recording of this design' : 'nothing selected'}
        </Box>
      }
    >
      {(u) => (
        <div>
          <video
            ref={(el) => (video = el)}
            autoplay={!props.paused}
            muted
            loop
            playsinline
            poster={u.poster}
            onPlaying={() => setState('playing')}
            onWaiting={() => setState('loading')}
            onPause={() => setState('paused')}
            onError={() => setState('error')}
            onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
            onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
            style={{ width: '100%', 'aspect-ratio': '4 / 3', background: '#000', display: 'block', cursor: 'pointer' }}
          >
            <source src={u.webm} type="video/webm" />
            <source src={u.mp4} type="video/mp4" />
          </video>
          <div style={{ height: '3px', background: '#ddd' }}>
            <div style={{ height: '3px', width: `${progress() * 100}%`, background: state() === 'playing' ? '#544ead' : '#999' }} />
          </div>
          <Typography variant="caption" component="div" sx={{ color: state() === 'error' ? 'error.main' : 'text.secondary' }}>
            {label()}
          </Typography>
          <For each={[recordingNote(props.shuttle, props.macro), props.note].filter(Boolean)}>
            {(n) => (
              <Typography variant="caption" component="div" sx={{ color: '#7a5c00' }}>
                {n}
              </Typography>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}

export function Preview() {
  const [mode, setMode] = createSignal<'stopped' | 'playing' | 'paused'>('stopped');
  const playing = () => mode() === 'playing';
  const [elapsed, setElapsed] = createSignal(0);
  const total = createMemo(() => s.seq.projects.reduce<number>((n, e) => n + Math.max(0, e.duration_ms || 0), 0));

  const shown = () => s.selected();
  const entry = () => (shown() === null ? undefined : s.seq.projects[shown()!]);
  const macro = () => {
    const e = entry();
    return e ? s.projectOf(e)?.macro : undefined;
  };

  // bumped by a jump, so a running timer restarts from the new position
  const [epoch, setEpoch] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    epoch();
    clearInterval(timer);
    if (!playing() || !total()) return;
    const start = Date.now() - untrack(elapsed);
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
    setEpoch(epoch() + 1);
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Preview
          </Typography>
          <Show when={mode() !== 'stopped'}>
            <Button
              size="small"
              sx={{ mr: 1 }}
              onClick={() => {
                setMode('stopped');
                setElapsed(0);
              }}
            >
              Stop
            </Button>
          </Show>
          <Button size="small" variant={playing() ? 'contained' : 'outlined'} disabled={!total()} onClick={() => setMode(playing() ? 'paused' : 'playing')}>
            {{ stopped: 'Play sequence', playing: 'Pause', paused: 'Resume' }[mode()]}
          </Button>
        </Stack>
        <Show when={s.seq.projects.length} fallback={<Typography variant="body2">The sequence is empty: its designs' recorded videos play here.</Typography>}>
        <Clip
          shuttle={s.seq.shuttle}
          macro={macro()}
          paused={mode() === 'paused'}
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
            <Show when={mode() !== 'stopped'}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, width: '2px', background: playing() ? '#8afbfd' : '#ff9800', left: `${(elapsed() / total()) * 100}%` }} />
            </Show>
          </div>
          <Typography variant="caption">
            <Show when={mode() !== 'stopped'}>
              {playing() ? 'Playing' : 'Paused'} at {(elapsed() / 1000).toFixed(1)} s ·{' '}
            </Show>
            One loop: {(total() / 1000).toFixed(1)} s, {s.seq.projects.length} designs
          </Typography>
        </Show>
      </CardContent>
    </Card>
  );
}
