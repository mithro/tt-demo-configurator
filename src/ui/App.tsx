// SPDX-License-Identifier: Apache-2.0
//
// Layout: the header carries the board's status and Connect. Below, three columns that
// each scroll on their own: the design library (where you pick from), the sequence
// (what you are building), and the preview with the board's controls.
import { AppBar, Box, Button, Chip, CssBaseline, LinearProgress, ThemeProvider, Toolbar, Typography } from '@suid/material';
import { For, Show } from 'solid-js';
import { BoardPanel } from './BoardPanel';
import { ConfirmOpsDialog } from './ConfirmOps';
import { DesignList } from './DesignList';
import { Preview } from './Preview';
import { SequenceEditor } from './SequenceEditor';
import { state as s } from './state';
import { theme } from './theme';

function Log() {
  const colour = { info: '#333', error: '#b00020', ok: '#1b5e20' };
  return (
    <Box sx={{ fontFamily: 'monospace', fontSize: '12px', maxHeight: '30vh', overflow: 'auto', background: '#fafafa', p: 1, border: '1px solid #eee' }}>
      <For each={[...s.log()].reverse()} fallback={<span style={{ opacity: 0.6 }}>Messages appear here.</span>}>
        {(l) => (
          <div style={{ color: colour[l.kind] }}>
            {l.time} {l.text}
          </div>
        )}
      </For>
    </Box>
  );
}

function BoardStatus() {
  const label = () => {
    const b = s.board();
    if (!s.repl()) return 'No board connected';
    if (!b) return 'Reading the board…';
    const chip = b.isFpga ? 'FPGA board' : (b.shuttle ?? 'unknown chip');
    const fw = { custom: 'demo firmware', helper: 'stock + helper', stock: 'stock', handmade: 'hand-made demo' }[b.firmware];
    return `${chip} · SDK ${b.sdk ?? '?'} · ${fw}${b.demoRunning || s.ramRunning() ? ' · demo running' : ''}`;
  };
  return (
    <>
      <Chip
        label={label()}
        sx={{ background: s.repl() ? '#8afbfd' : 'rgba(255,255,255,0.15)', color: s.repl() ? '#1c1b2e' : '#fff', mr: 1, maxWidth: '50vw', display: { xs: s.repl() ? 'flex' : 'none', sm: 'flex' } }}
      />
      <Show
        when={s.repl()}
        fallback={
          <Button variant="contained" color="secondary" size="small" onClick={() => s.connect()} disabled={s.busy() !== null}>
            Connect
          </Button>
        }
      >
        <Button size="small" sx={{ color: '#fff' }} onClick={() => s.disconnect()}>
          Disconnect
        </Button>
      </Show>
    </>
  );
}

const HEADER = 48;

/**
 * One column. A plain flex column that scrolls, except `fill`, which hands its height to
 * its one child (the design library) so that child can scroll a part of itself. (Not a
 * grid: grid items with overflow:hidden, like cards, shrink to fit and get clipped.)
 */
function Column(props: { children: any; label: string; fill?: boolean }) {
  return (
    <Box
      component="section"
      aria-label={props.label}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        overflowY: { md: props.fill ? 'hidden' : 'auto' },
        height: { md: `calc(100vh - ${HEADER}px)` },
        p: 2,
        '& > *': { flexShrink: props.fill ? 1 : 0 },
      }}
    >
      {props.children}
    </Box>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="sticky" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: `${HEADER}px` }}>
          <Typography variant="h6" sx={{ flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', mr: 1 }}>
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Tiny Tapeout{' '}
            </Box>
            Demo Configurator
          </Typography>
          <BoardStatus />
          <Typography variant="caption" sx={{ ml: 2, opacity: 0.7, display: { xs: 'none', md: 'block' } }}>
            {__COMMIT_HASH__}
          </Typography>
        </Toolbar>
        <Show when={s.busy()}>
          <LinearProgress color="secondary" sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }} />
        </Show>
      </AppBar>
      <Box
        sx={{
          display: { xs: 'block', md: 'grid' },
          gridTemplateColumns: { md: 'minmax(300px, 380px) minmax(420px, 1fr) minmax(320px, 420px)' },
          background: '#f6f5fb',
          minHeight: `calc(100vh - ${HEADER}px)`,
        }}
      >
        <Column label="Designs" fill>
          <DesignList />
        </Column>
        <Column label="Sequence">
          <SequenceEditor />
        </Column>
        <Column label="Preview and board">
          <Preview />
          <BoardPanel />
          <Box>
            <Typography variant="subtitle2">
              Messages <Show when={s.busy()}>({s.busy()}…)</Show>
            </Typography>
            <Log />
          </Box>
        </Column>
      </Box>
      <ConfirmOpsDialog />
    </ThemeProvider>
  );
}
