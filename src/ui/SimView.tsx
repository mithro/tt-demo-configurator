// SPDX-License-Identifier: Apache-2.0
// A design simulated in the browser (src/sim), drawn as a 640x480 monitor would show it,
// with the entry's ui_in and steps applied.
import { Box, Button, Typography } from '@suid/material';
import { createEffect, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import type { Entry } from '~/lib/demoFile';
import type { Project } from '~/lib/shuttleIndex';
import { openSim, type SimSession } from '~/sim/client';
import type { FromWorker, SimState, SimStats } from '~/sim/protocol';

const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

export function SimView(props: {
  project: Project | undefined;
  /** The sequence entry; without one the design runs with ui_in 0, no steps, its own clock. */
  entry?: Pick<Entry, 'ui_in' | 'steps' | 'clock_hz'>;
  /** Whether the sequence is playing; when it isn't, a click runs just this design. */
  running: boolean;
  pausedLabel?: string;
  onUseRecording?: () => void;
}) {
  const [state, setState] = createSignal<SimState | 'idle' | 'starting'>('idle');
  const [reason, setReason] = createSignal<string>();
  const [note, setNote] = createSignal<string>();
  const [stats, setStats] = createSignal<SimStats>();
  const [hasFrame, setHasFrame] = createSignal(false);
  // a click while the sequence isn't playing runs (or holds) just this design
  const [clicked, setClicked] = createSignal<boolean | null>(null);
  const wantRun = () => clicked() ?? props.running;
  let canvas: HTMLCanvasElement | undefined;
  let session: SimSession | null = null;

  const onMessage = (m: FromWorker) => {
    if (m.type === 'status') {
      setState(m.state);
      setReason(m.reason);
      setNote(m.note);
    } else if (m.type !== 'ready') {
      setStats(m.stats);
      if (m.type === 'frame' && canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.putImageData(new ImageData(new Uint8ClampedArray(m.pixels), 640, 480), 0, 0);
        setHasFrame(true);
      }
    }
  };

  const load = () => {
    session?.close();
    session = null;
    const p = props.project;
    setStats(undefined);
    setHasFrame(false);
    setReason(undefined);
    canvas?.getContext('2d')?.clearRect(0, 0, 640, 480);
    if (!p) {
      setState('idle');
      return;
    }
    const e = props.entry;
    setState('starting');
    session = openSim(
      {
        design: { macro: p.macro, repo: p.repo, commit: p.commit },
        // plain copies: store proxies can't be posted to a worker
        entry: { ui_in: e?.ui_in ?? 0, steps: JSON.parse(JSON.stringify(e?.steps ?? [])), clock_hz: e?.clock_hz ?? p.clock_hz },
        run: untrack(wantRun),
      },
      onMessage,
    );
  };

  // a different design or different inputs start again from power-on
  createEffect(
    on(
      () => [props.project?.macro, props.project?.commit, props.entry?.ui_in, JSON.stringify(props.entry?.steps), props.entry?.clock_hz],
      () => load(),
    ),
  );
  createEffect(
    on(
      () => props.running,
      () => setClicked(null),
      { defer: true },
    ),
  );
  createEffect(
    on(wantRun, (run) => session?.run(run), { defer: true }),
  );
  onCleanup(() => session?.close());

  const busy = () => state() === 'starting' || state() === 'fetching' || state() === 'compiling';
  const label = () => {
    const st = stats();
    switch (state()) {
      case 'idle':
        return props.project ? '' : 'nothing selected';
      case 'starting':
        return 'starting the simulator (about 4 MB to download the first time)…';
      case 'fetching':
        return "fetching the design's sources from GitHub…";
      case 'compiling':
        return `compiling with Verilator (WebAssembly)…${note() ? ` (${note()})` : ''}`;
      case 'paused':
        return props.pausedLabel ?? 'paused (click to run)';
      case 'superseded':
        return 'another preview is using the simulator (click to simulate here again)';
      case 'running':
        if (!st?.fps) return 'simulating…';
        return `simulating · ${st.fps.toFixed(1)} fps · ${(st.simMs / 1000).toFixed(1)} s simulated · ui_in ${hex(st.uiIn)}`;
      default:
        return '';
    }
  };
  const slow = () => {
    const st = stats();
    return state() === 'running' && st && st.simMs > 1000 && st.speed > 0 && st.speed < 0.95 ? st.speed : null;
  };
  const warnings = () => {
    const st = stats();
    const w: string[] = [];
    if (note() && state() !== 'compiling') w.push(note()!);
    if (st?.noSync) w.push('No hsync from the design: a monitor would show no picture.');
    else if (st && st.lineClocks && !st.standard)
      w.push(
        `Not 640x480@60 timing: ${(st.lineHz / 1000).toFixed(2)} kHz lines (31.47 expected; ${st.lineClocks} clocks each), ${st.frameLines} lines per frame (525 expected). A real monitor may show this differently or not at all.`,
      );
    return w;
  };

  return (
    <div>
      <Box
        sx={{ position: 'relative', aspectRatio: '4 / 3', background: '#000', cursor: props.project ? 'pointer' : 'default' }}
        onClick={() => {
          if (state() === 'superseded') load();
          else if (state() === 'running' || state() === 'paused') setClicked(!wantRun());
        }}
      >
        <canvas ref={canvas} width={640} height={480} style={{ width: '100%', height: '100%', display: 'block', 'image-rendering': 'pixelated' }} />
        <Show when={busy() || (!hasFrame() && state() !== 'running' && state() !== 'paused')}>
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', textAlign: 'center', px: 2 }}>
            {state() === 'failed' ? "couldn't simulate this design" : busy() ? label() : props.project ? '' : 'nothing selected'}
          </Box>
        </Show>
      </Box>
      <Show
        when={state() !== 'failed'}
        fallback={
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" component="div" sx={{ color: 'error.main' }}>
              Couldn't simulate: {reason()}
            </Typography>
            <Show when={props.onUseRecording}>
              <Button size="small" onClick={() => props.onUseRecording?.()}>
                Show the recording instead
              </Button>
            </Show>
          </Box>
        }
      >
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
          {label()}
        </Typography>
      </Show>
      <Show when={slow()}>
        {(sp) => (
          <Typography variant="caption" component="div" sx={{ color: '#7a5c00' }}>
            Slower than real time: {(sp() * 100).toFixed(0)}% speed. The board shows 60 fps; here steps and animations play in simulated time, so they look {(1 / sp()).toFixed(1)}× slower.
          </Typography>
        )}
      </Show>
      <Show when={state() === 'running' || state() === 'paused'}>
        <For each={warnings()}>
          {(w) => (
            <Typography variant="caption" component="div" sx={{ color: '#7a5c00' }}>
              {w}
            </Typography>
          )}
        </For>
      </Show>
    </div>
  );
}
