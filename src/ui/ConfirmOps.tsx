// SPDX-License-Identifier: Apache-2.0
// "These files will change on the board": shown before every write, so nothing on the
// board changes without the user seeing exactly what.
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@suid/material';
import { createSignal, For, Show } from 'solid-js';
import type { FileOp } from '~/lib/helper';

interface Pending {
  title: string;
  ops: FileOp[];
  warnings: string[];
  resolve: (ok: boolean) => void;
}

const [pending, setPending] = createSignal<Pending | null>(null);

/** Ask before applying ops; resolves true when the user confirms. */
export function confirmOps(title: string, ops: FileOp[], warnings: string[] = []): Promise<boolean> {
  return new Promise((resolve) => setPending({ title, ops, warnings, resolve }));
}

export function ConfirmOpsDialog() {
  const close = (ok: boolean) => {
    pending()?.resolve(ok);
    setPending(null);
  };
  return (
    <Dialog open={pending() !== null} onClose={() => close(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{pending()?.title}</DialogTitle>
      <DialogContent>
        <For each={pending()?.warnings ?? []}>{(w) => <Alert severity="warning" sx={{ mb: 1 }}>{w}</Alert>}</For>
        <Show when={pending()?.ops.length} fallback={<Typography>Nothing on the board needs to change.</Typography>}>
          <Typography variant="body2" gutterBottom>
            These files on the board will change:
          </Typography>
          <ul style={{ margin: 0 }}>
            <For each={pending()?.ops}>
              {(op) => (
                <li>
                  <code>{op.op === 'write' ? 'write' : 'delete'} {op.path}</code>: {op.why}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => close(false)}>Cancel</Button>
        <Button variant="contained" onClick={() => close(true)}>
          Go ahead
        </Button>
      </DialogActions>
    </Dialog>
  );
}
