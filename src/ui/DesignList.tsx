// SPDX-License-Identifier: Apache-2.0
// The shuttle's designs: filter by Pmod (Tiny VGA by default), search, sort, add to the
// sequence; and a walk-through that shows them one at a time, like the Shenzhen set-up.
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@suid/material';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { clipUrls, pmodsOf, Project, projectKey, videoInfo } from '~/lib/shuttleIndex';
import { showOne } from '~/lib/live';
import { state as s, VGA_CLOCK_HZ } from './state';
import { Clip } from './Preview';

type Filter = 'tiny-vga' | 'gamepad' | 'all';
type Sort = 'title' | 'address' | 'video';

export function DesignList() {
  const [filter, setFilter] = createSignal<Filter>('tiny-vga');
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal<Sort>('title');
  const [walk, setWalk] = createSignal<number | null>(null);

  const inSeq = createMemo(() => new Set(s.seq.projects.map((e) => projectKey(e))));
  const list = createMemo(() => {
    const q = query().trim().toLowerCase();
    const f = filter();
    const out = s.projects().filter((p) => {
      if (f !== 'all' && !pmodsOf(s.seq.shuttle, p).includes(f)) return false;
      if (!q) return true;
      return `${p.title} ${p.author} ${p.macro} ${p.address}`.toLowerCase().includes(q);
    });
    const by = sort();
    const video = (p: Project) => (videoInfo(s.seq.shuttle, p.macro)?.verdict === 'ok' ? 0 : clipUrls(s.seq.shuttle, p.macro) ? 1 : 2);
    return out.sort((a, b) =>
      by === 'address' ? a.address - b.address || a.subtile - b.subtile : by === 'video' ? video(a) - video(b) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title),
    );
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {s.seq.shuttle ? `Designs on ${s.seq.shuttle}` : 'Designs'}
          </Typography>
          <Button size="small" variant="outlined" disabled={!list().length} onClick={() => setWalk(0)}>
            Walk through
          </Button>
        </Stack>
        <Show when={!s.seq.shuttle}>
          <Typography variant="body2">Choose a shuttle (or connect a board) to list its designs.</Typography>
        </Show>
        <Show when={s.projectsError()}>
          <Alert severity="error">{s.projectsError()}</Alert>
        </Show>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <For each={[['tiny-vga', 'Tiny VGA'], ['gamepad', 'Gamepad'], ['all', 'All']] as [Filter, string][]}>
            {([k, label]) => (
              <Chip label={label} color={filter() === k ? 'primary' : 'default'} onClick={() => setFilter(k)} />
            )}
          </For>
          <Select size="small" value={sort()} onChange={(e) => setSort(e.target.value as Sort)}>
            <MenuItem value="title">by title</MenuItem>
            <MenuItem value="address">by address</MenuItem>
            <MenuItem value="video">recorded first</MenuItem>
          </Select>
        </Stack>
        <TextField size="small" fullWidth placeholder="Search title, author, macro, address" value={query()} onChange={(_, v) => setQuery(v)} />
        <Typography variant="caption" sx={{ display: 'block', my: 0.5 }}>
          {list().length} of {s.projects().length} designs
        </Typography>
        <div>
          <For each={list()}>
            {(p, i) => {
              const clip = () => clipUrls(s.seq.shuttle, p.macro);
              return (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5, borderBottom: '1px solid #eee' }}>
                  <Show when={clip()} fallback={<div style={{ width: '80px', height: '60px', background: '#222', color: '#888', 'font-size': '10px', display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>no video</div>}>
                    <img src={clip()!.poster} width={80} height={60} loading="lazy" alt="" style={{ background: '#000', 'object-fit': 'cover', cursor: 'pointer' }} onClick={() => setWalk(i())} />
                  </Show>
                  <div style={{ 'flex-grow': 1, 'min-width': 0 }}>
                    <Typography variant="body2" noWrap>
                      <Show when={inSeq().has(projectKey(p))}>
                        <span title="in the sequence" style={{ color: '#544ead' }}>✓ </span>
                      </Show>
                      <b>{p.title}</b>
                    </Typography>
                    <Typography variant="caption" noWrap component="div">
                      {projectKey(p)} · {p.author} · {p.clock_hz ? `${(p.clock_hz / 1e6).toFixed(3)} MHz` : 'clock not set'}
                      {p.danger_level && p.danger_level !== 'safe' ? ` · not safe (${p.danger_level})` : ''}
                    </Typography>
                  </div>
                  <Button size="small" disabled={p.danger_level !== undefined && p.danger_level !== 'safe'} onClick={() => s.addProject(p)}>
                    Add
                  </Button>
                </Stack>
              );
            }}
          </For>
        </div>
      </CardContent>
      <WalkThrough list={list()} index={walk()} setIndex={setWalk} inSeq={inSeq()} />
    </Card>
  );
}

function WalkThrough(props: { list: Project[]; index: number | null; setIndex: (i: number | null) => void; inSeq: Set<string> }) {
  const p = () => (props.index === null ? undefined : props.list[props.index]);
  const next = () => {
    const i = props.index ?? 0;
    props.setIndex(i + 1 < props.list.length ? i + 1 : null);
  };
  const onBoard = () => {
    const proj = p();
    const b = s.board();
    if (!proj || !b) return;
    void s.job('showing on the board', (r) =>
      showOne(r, b, s.seq.shuttle, { address: proj.address, subtile: proj.subtile, duration_ms: 15000, clock_hz: proj.clock_hz || VGA_CLOCK_HZ, ui_in: 0, steps: [] }),
    ).then((errs) => {
      if (errs?.length) s.say(errs.join('; '), 'error');
      else if (errs) s.setRamRunning(true);
    });
  };
  return (
    <Dialog open={props.index !== null} onClose={() => props.setIndex(null)} maxWidth="md" fullWidth>
      <Show when={p()}>
        {(proj) => (
          <>
            <DialogTitle>
              {proj().title} <span style={{ opacity: 0.6, 'font-size': '0.8em' }}>({(props.index ?? 0) + 1} of {props.list.length})</span>
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" gutterBottom>
                {proj().author} · address {projectKey(proj())} · {proj().macro}
              </Typography>
              <Clip shuttle={s.seq.shuttle} macro={proj().macro} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => props.setIndex(Math.max(0, (props.index ?? 0) - 1))} disabled={!props.index}>
                Back
              </Button>
              <Show when={s.board()}>
                <Button onClick={onBoard}>Show on the board</Button>
              </Show>
              <span style={{ 'flex-grow': 1 }} />
              <Button onClick={next}>Skip</Button>
              <Button
                variant="contained"
                disabled={proj().danger_level !== undefined && proj().danger_level !== 'safe'}
                onClick={() => {
                  s.addProject(proj());
                  next();
                }}
              >
                {props.inSeq.has(projectKey(proj())) ? 'Include again' : 'Include'}
              </Button>
            </DialogActions>
          </>
        )}
      </Show>
    </Dialog>
  );
}
