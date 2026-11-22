// SPDX-License-Identifier: Apache-2.0
import { CssBaseline, ThemeProvider, Typography } from '@suid/material';
import { theme } from './theme';

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Typography variant="h5">Tiny Tapeout Demo Configurator</Typography>
    </ThemeProvider>
  );
}
