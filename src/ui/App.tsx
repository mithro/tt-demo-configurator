// SPDX-License-Identifier: Apache-2.0
import { AppBar, Box, CssBaseline, LinearProgress, ThemeProvider, Toolbar, Typography } from '@suid/material';
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
    <Box sx={{ fontFamily: 'monospace', fontSize: '12px', maxHeight: '22vh', overflow: 'auto', background: '#fafafa', p: 1, border: '1px solid #eee' }}>
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

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="sticky">
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Tiny Tapeout Demo Configurator
          </Typography>
          <Typography variant="caption">{__COMMIT_HASH__}</Typography>
        </Toolbar>
        <Show when={s.busy()}>
          <LinearProgress color="secondary" />
        </Show>
      </AppBar>
      <Box
        sx={{
          p: 2,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(320px, 1fr) minmax(360px, 1.3fr) minmax(300px, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: 'grid', gap: 2 }}>
          <BoardPanel />
          <Box>
            <Typography variant="subtitle2">
              Messages <Show when={s.busy()}>({s.busy()}…)</Show>
            </Typography>
            <Log />
          </Box>
        </Box>
        <SequenceEditor />
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Preview />
          <DesignList />
        </Box>
      </Box>
      <ConfirmOpsDialog />
    </ThemeProvider>
  );
}
