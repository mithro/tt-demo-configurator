// SPDX-License-Identifier: Apache-2.0
// The shuttle's designs: search (titles, authors, tags), filter by Pmod (Tiny VGA by default),
// sort, add to the sequence; and a one-at-a-time review that shows each design's recording, like the
// Shenzhen set-up. The list scrolls inside the card so the filters stay in view.
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Link,
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
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import { FPGA_SHUTTLE } from '~/lib/fpga';
import { formatHz } from '~/lib/frequency';
import { showOne } from '~/lib/live';
import { boardUsable } from './actions';
import { PMOD_LIST, searchUrl, SiliconStatus } from '~/lib/projectSearch';
import { clipUrls, mediaShuttle, pmodsOf, Project, projectKey, videoInfo } from '~/lib/shuttleIndex';
import { Clip } from './Preview';
import { previewSource, PreviewSourceToggle, setPreviewSource } from './PreviewSource';
import { SimView } from './SimView';
import { state as s, VGA_CLOCK_HZ } from './state';

/** A Pmod id from the project-search list, or every design. */
type Filter = string;
type Sort = 'title' | 'address' | 'video' | 'silicon';

const SILICON: Record<SiliconStatus, { mark: string; color: string; words: string; rank: number }> = {
  working: { mark: '✓ chip', color: '#2e7d32', words: 'reported working on real chips', rank: 0 },
  partial: { mark: '◐ chip', color: '#b26a00', words: 'reported partly working on real chips', rank: 1 },
  untested: { mark: '', color: '', words: 'no reports from real chips yet', rank: 2 },
  broken: { mark: '✗ chip', color: '#c62828', words: 'reported not working on real chips', rank: 3 },
};

/** Chip labels; the full name and pins show on hover. */
const SHORT: Record<string, string> = {
  'tiny-vga': 'Tiny VGA',
  'tt-audio': 'Audio',
  'qspi-pmod': 'QSPI',
  gamepad: 'Gamepad',
  spi: 'SPI',
  'uart-pmod': 'UART',
  'i2c-pmod': 'I2C',
  'uart-usb': 'USB UART',
};

function siliconTitle(p: Project): string {
  const s = p.search?.silicon;
  if (!s) return 'not in the project-search database';
  const counts = [s.working && `${s.working} working`, s.partial && `${s.partial} partly`, s.broken && `${s.broken} not working`].filter(Boolean);
  return `${SILICON[s.status].words}${counts.length ? ` (${counts.join(', ')})` : ''}`;
}

function SiliconMark(props: { project: Project }) {
  const s = () => props.project.search?.silicon.status;
  return (
    <Show when={s() && SILICON[s()!].mark}>
      <span title={siliconTitle(props.project)} style={{ color: SILICON[s()!].color, 'font-weight': 600, 'margin-right': '4px', 'white-space': 'nowrap' }}>
        {SILICON[s()!].mark}
      </span>
    </Show>
  );
}

const THUMB = { width: '80px', height: '60px', 'flex-shrink': 0 } as const;

function Thumb(props: { project: Project; onClick: () => void }) {
  const shuttle = () => mediaShuttle(s.seq.shuttle, props.project);
  const clip = () => clipUrls(shuttle(), props.project.macro);
  const still = () => ['static', 'blank'].includes(videoInfo(shuttle(), props.project.macro)?.verdict ?? '');
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
  // most of an FPGA board's bitstreams have no pinout to match a Pmod from: show them all
  createEffect(on(() => s.seq.shuttle, (id) => id === FPGA_SHUTTLE && setFilter('all')));

  const inSeq = createMemo(() => new Set(s.seq.projects.map((e) => projectKey(e))));
  /** how many of the shuttle's designs each Pmod matches; only Pmods with a match get a chip */
  const pmodCounts = createMemo(() => {
    const n = new Map<string, number>();
    for (const p of s.projects()) for (const id of pmodsOf(s.seq.shuttle, p)) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  });
  const filters = createMemo(() => [
    ...PMOD_LIST.filter((m) => pmodCounts().has(m.id) || m.id === filter()).map((m) => ({ id: m.id, label: `${SHORT[m.id] ?? m.name} ${pmodCounts().get(m.id) ?? 0}`, about: `${m.name}: ${m.pins}` })),
    { id: 'all', label: 'All', about: 'every design on the shuttle' },
  ]);
  const list = createMemo(() => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const f = filter();
    const out = s.projects().filter((p) => {
      if (f !== 'all' && !pmodsOf(s.seq.shuttle, p).includes(f)) return false;
      const hay = `${p.title} ${p.author} ${p.macro} ${p.address} ${p.search?.tags.join(' ') ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const by = sort();
    const rank = (p: Project) => {
      const id = mediaShuttle(s.seq.shuttle, p);
      return videoInfo(id, p.macro)?.verdict === 'ok' ? 0 : clipUrls(id, p.macro) ? 1 : 2;
    };
    const chip = (p: Project) => SILICON[p.search?.silicon.status ?? 'untested'].rank;
    return out.sort((a, b) =>
      by === 'address'
        ? a.address - b.address || a.subtile - b.subtile
        : by === 'video'
          ? rank(a) - rank(b) || a.title.localeCompare(b.title)
          : by === 'silicon'
            ? chip(a) - chip(b) || a.title.localeCompare(b.title)
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
        <Show when={s.seq.shuttle === FPGA_SHUTTLE && s.projectsFor() === FPGA_SHUTTLE}>
          <Typography variant="caption" component="div" sx={{ mb: 1 }}>
            The designs of the connected FPGA board: the bitstreams in its <code>/bitstreams</code>, numbered as its
            firmware lists them. One named like a Tiny Tapeout project is shown with that project’s details and recording.
          </Typography>
        </Show>
        <Show when={s.seq.shuttle}>
          <TextField size="small" fullWidth placeholder="Search title, author, macro, address, tags" value={query()} onChange={(_, v) => setQuery(v)} />
          <Stack direction="row" sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
            <For each={filters()}>
              {(f) => <Chip size="small" label={f.label} title={f.about} color={filter() === f.id ? 'primary' : 'default'} onClick={() => setFilter(f.id)} />}
            </For>
            <span style={{ 'flex-grow': 1 }} />
            <Select size="small" variant="standard" value={sort()} onChange={(e) => setSort(e.target.value as Sort)} sx={{ fontSize: '13px' }}>
              <MenuItem value="title">A–Z</MenuItem>
              <MenuItem value="address">by address</MenuItem>
              <MenuItem value="video">recorded first</MenuItem>
              <MenuItem value="silicon">working on chips first</MenuItem>
            </Select>
          </Stack>
          <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.7 }}>
            Pmods are matched from pin names, not tested; tags are AI-written and unchecked (from the{' '}
            <Link href="https://mith.ro/tinytapeout-project-search/" target="_blank">
              project search
            </Link>
            ).
          </Typography>
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
                  <SiliconMark project={p} />
                  {[projectKey(p), p.author, p.known && `as on ${p.known.shuttle}`, p.clock_hz ? formatHz(p.clock_hz) : 'clock not set']
                    .filter(Boolean)
                    .join(' · ')}
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
    const r = s.repl();
    void s
      .job('showing on the board', (r) =>
        showOne(r, b, s.seq.shuttle, { address: proj.address, subtile: proj.subtile, duration_ms: 15000, clock_hz: proj.clock_hz || VGA_CLOCK_HZ, ui_in: 0, steps: [] }),
      )
      .then((errs) => {
        if (errs?.length) s.say(errs.join('; '), 'error');
        else if (errs) s.markRamRunning(r);
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
                {[proj().author, `address ${projectKey(proj())}`, proj().macro].filter(Boolean).join(' · ')}
                <Show when={props.inSeq.has(projectKey(proj()))}> · already in the sequence</Show>
              </Typography>
              <Show when={proj().known}>
                {(k) => (
                  <Typography variant="body2" gutterBottom>
                    A bitstream named like {proj().macro} at address {k().address} on {k().shuttle}: shown with that
                    project’s details, recording and sources (matched by name only).
                  </Typography>
                )}
              </Show>
              <Typography variant="body2" gutterBottom>
                {siliconTitle(proj())[0].toUpperCase() + siliconTitle(proj()).slice(1)}
                {' · Pmods: '}
                {pmodsOf(s.seq.shuttle, proj())
                  .map((id) => PMOD_LIST.find((m) => m.id === id)?.name ?? id)
                  .join(', ') || 'none matched'}
                {' · '}
                <Link href={searchUrl(mediaShuttle(s.seq.shuttle, proj()), proj().macro)} target="_blank">
                  full entry in the project search
                </Link>
              </Typography>
              <Show when={proj().search?.tags.length}>
                <Typography variant="caption" component="div" gutterBottom>
                  Tags (AI-written, unchecked): {proj().search!.tags.join(', ')}
                </Typography>
              </Show>
              <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1 }}>
                <PreviewSourceToggle />
              </Stack>
              <Show when={previewSource() === 'simulation'} fallback={<Clip shuttle={mediaShuttle(s.seq.shuttle, proj())} macro={proj().macro} />}>
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
