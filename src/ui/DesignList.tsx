// SPDX-License-Identifier: Apache-2.0
// The shuttle's designs: search, filter by Pmod (Tiny VGA by default), sort, add to the
// sequence; and a one-at-a-time review that shows each design's recording, like the
// Shenzhen set-up. The list scrolls inside the card so the filters stay in view.
import {
  Alert,
  Box,
  Button,
  Card,
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
import { showOne } from '~/lib/live';
import { boardUsable } from './actions';
import { clipUrls, pmodsOf, Project, projectKey, videoInfo } from '~/lib/shuttleIndex';
import { Clip } from './Preview';
import { previewSource, PreviewSourceToggle, setPreviewSource } from './PreviewSource';
import { SimView } from './SimView';
import { state as s, VGA_CLOCK_HZ } from './state';

type Filter = 'tiny-vga' | 'gamepad' | 'all';
type Sort = 'title' | 'address' | 'video';
const FILTERS: [Filter, string][] = [
  ['tiny-vga', 'Tiny VGA'],
  ['gamepad', 'Gamepad'],
  ['all', 'All'],
];

const THUMB = { width: '80px', height: '60px', 'flex-shrink': 0 } as const;

function Thumb(props: { project: Project; onClick: () => void }) {
  const clip = () => clipUrls(s.seq.shuttle, props.project.macro);
  const still = () => ['static', 'blank'].includes(videoInfo(s.seq.shuttle, props.project.macro)?.verdict ?? '');
  return (
    <div style={{ ...THUMB, position: 'relative', background: '#222', cursor: clip() ? 'pointer' : 'default' }} onClick={() => clip() && props.onClick()}>
      <Show
        when={clip()}
        fallback={
          <div style={{ ...THUMB, color: '#999', 'font-size': '11px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'text-align': 'center' }}>
            no video
          </div>
        }
      >
        <img src={clip()!.poster} width={80} height={60} loading="lazy" alt="" style={{ ...THUMB, display: 'block', 'object-fit': 'cover', background: '#000' }} />
        <Show when={still()}>
          <span style={{ position: 'absolute', right: '2px', bottom: '2px', background: 'rgba(0,0,0,0.7)', color: '#ddd', 'font-size': '9px', padding: '0 3px', 'border-radius': '3px' }}>
            still
          </span>
        </Show>
      </Show>
    </div>
  );
}

export function DesignList() {
  const [filter, setFilter] = createSignal<Filter>('tiny-vga');
  const [query, setQuery] = createSignal('');
  const [sort, setSort] = createSignal<Sort>('title');
  const [review, setReview] = createSignal<number | null>(null);

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
    const rank = (p: Project) => (videoInfo(s.seq.shuttle, p.macro)?.verdict === 'ok' ? 0 : clipUrls(s.seq.shuttle, p.macro) ? 1 : 2);
    return out.sort((a, b) =>
      by === 'address'
        ? a.address - b.address || a.subtile - b.subtile
        : by === 'video'
          ? rank(a) - rank(b) || a.title.localeCompare(b.title)
          : a.title.localeCompare(b.title),
    );
  });

  return (
    <Card variant="outlined" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: { md: 1 } }}>
      <Box sx={{ p: 2, pb: 1, borderBottom: '1px solid #eee' }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Designs{s.seq.shuttle ? ` on ${s.seq.shuttle}` : ''}
          </Typography>
          <Show when={s.projects().length}>
            <Typography variant="caption">
              {list().length} of {s.projects().length}
            </Typography>
          </Show>
        </Stack>
        <Show when={!s.seq.shuttle}>
          <Typography variant="body2">Choose a shuttle (or connect a board) to list its designs.</Typography>
        </Show>
        <Show when={s.projectsError()}>
          <Alert severity="error">{s.projectsError()}</Alert>
        </Show>
        <Show when={s.seq.shuttle}>
          <TextField size="small" fullWidth placeholder="Search title, author, macro, address" value={query()} onChange={(_, v) => setQuery(v)} />
          <Stack direction="row" spacing={0.5} sx={{ mt: 1, alignItems: 'center' }}>
            <For each={FILTERS}>
              {([k, label]) => <Chip size="small" label={label} color={filter() === k ? 'primary' : 'default'} onClick={() => setFilter(k)} />}
            </For>
            <span style={{ 'flex-grow': 1 }} />
            <Select size="small" variant="standard" value={sort()} onChange={(e) => setSort(e.target.value as Sort)} sx={{ fontSize: '13px' }}>
              <MenuItem value="title">A–Z</MenuItem>
              <MenuItem value="address">by address</MenuItem>
              <MenuItem value="video">recorded first</MenuItem>
            </Select>
          </Stack>
          <Button size="small" fullWidth variant="outlined" sx={{ mt: 1 }} disabled={!list().length} onClick={() => setReview(0)}>
            Review these {list().length} one at a time
          </Button>
        </Show>
      </Box>
      <Box data-scroll="designs" sx={{ overflowY: 'auto', flex: { md: 1 }, minHeight: 0, maxHeight: { xs: '70vh', md: 'none' }, px: 2 }}>
        <For each={list()}>
          {(p, i) => (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5, borderBottom: '1px solid #eee' }}>
              <Thumb project={p} onClick={() => setReview(i())} />
              <div style={{ 'flex-grow': 1, 'min-width': 0 }}>
                <Typography variant="body2" noWrap>
                  <Show when={inSeq().has(projectKey(p))}>
                    <span title="in the sequence" style={{ color: '#544ead' }}>
                      ✓{' '}
                    </span>
                  </Show>
                  <b>{p.title}</b>
                </Typography>
                <Typography variant="caption" noWrap component="div">
                  {projectKey(p)} · {p.author} · {p.clock_hz ? `${(p.clock_hz / 1e6).toFixed(3)} MHz` : 'clock not set'}
                  {p.danger_level && p.danger_level !== 'safe' ? ` · not safe (${p.danger_level})` : ''}
                </Typography>
              </div>
              <Button size="small" sx={{ flexShrink: 0 }} disabled={p.danger_level !== undefined && p.danger_level !== 'safe'} onClick={() => s.addProject(p)}>
                Add
              </Button>
            </Stack>
          )}
        </For>
      </Box>
      <Review list={list()} index={review()} setIndex={setReview} inSeq={inSeq()} />
    </Card>
  );
}

function Review(props: { list: Project[]; index: number | null; setIndex: (i: number | null) => void; inSeq: Set<string> }) {
  const p = () => (props.index === null ? undefined : props.list[props.index]);
  const close = () => props.setIndex(null);
  const next = () => {
    const i = props.index ?? 0;
    props.setIndex(i + 1 < props.list.length ? i + 1 : null);
  };
  const onBoard = () => {
    const proj = p();
    const b = s.board();
    if (!proj || !b || !boardUsable()) return;
    void s
      .job('showing on the board', (r) =>
        showOne(r, b, s.seq.shuttle, { address: proj.address, subtile: proj.subtile, duration_ms: 15000, clock_hz: proj.clock_hz || VGA_CLOCK_HZ, ui_in: 0, steps: [] }),
      )
      .then((errs) => {
        if (errs?.length) s.say(errs.join('; '), 'error');
        else if (errs) s.setRamRunning(true);
      });
  };
  return (
    <Dialog open={props.index !== null} onClose={close} maxWidth="md" fullWidth>
      <Show when={p()}>
        {(proj) => (
          <>
            <DialogTitle>
              {proj().title}{' '}
              <span style={{ opacity: 0.6, 'font-size': '0.8em' }}>
                ({(props.index ?? 0) + 1} of {props.list.length})
              </span>
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" gutterBottom>
                {proj().author} · address {projectKey(proj())} · {proj().macro}
                <Show when={props.inSeq.has(projectKey(proj()))}> · already in the sequence</Show>
              </Typography>
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
                <PreviewSourceToggle />
              </Stack>
              <Show when={previewSource() === 'simulation'} fallback={<Clip shuttle={s.seq.shuttle} macro={proj().macro} />}>
                <SimView
                  project={proj()}
                  entry={{ ui_in: 0, steps: [], clock_hz: proj().clock_hz || VGA_CLOCK_HZ }}
                  running={true}
                  onUseRecording={() => setPreviewSource('recording')}
                />
              </Show>
            </DialogContent>
            <DialogActions>
              <Button onClick={close}>Close</Button>
              <Button onClick={() => props.setIndex(Math.max(0, (props.index ?? 0) - 1))} disabled={!props.index}>
                Back
              </Button>
              <Show when={boardUsable()}>
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
                Add to sequence
              </Button>
            </DialogActions>
          </>
        )}
      </Show>
    </Dialog>
  );
}
