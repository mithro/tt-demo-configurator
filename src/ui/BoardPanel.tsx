// SPDX-License-Identifier: Apache-2.0
// The connected board: what it is, how its demo mode is set up, and what can be done.
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Link, Stack, Typography } from '@suid/material';
import { For, JSX, Match, Show, Switch } from 'solid-js';
import type { BoardInfo, FirmwareType } from '~/lib/board';
import { CUSTOM_FIRMWARE, LATEST_STOCK, STOCK_RELEASE_URL, upgradeAvailable } from '~/lib/firmware';
import * as act from './actions';
import { state as s } from './state';

const FIRMWARE: Record<FirmwareType, { label: string; about: string }> = {
  custom: { label: 'Demo-mode firmware', about: 'The firmware has demo mode built in (hold RST at power-up to flip it for one boot).' },
  helper: { label: 'Stock firmware + demo helper', about: 'Stock firmware with this app’s helper (/demo.py and a wrapper main.py).' },
  stock: { label: 'Stock firmware', about: 'Plain stock firmware. Demo mode needs the helper (or the demo-mode firmware).' },
  handmade: { label: 'Hand-made demo', about: 'Set up by hand like the Shenzhen boards (/vga_cycle.py).' },
};

function romText(b: BoardInfo): string {
  if (b.rom && typeof b.rom === 'object') return `${b.rom.repo ?? ''} @ ${b.rom.commit || '(no commit)'}`;
  return String(b.rom ?? 'unreadable');
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: '6.5em' }}>
        {props.label}
      </Typography>
      <Typography variant="body2" component="div">
        {props.children}
      </Typography>
    </Stack>
  );
}

export function BoardPanel() {
  const b = () => s.board();
  const busy = () => s.busy() !== null;
  const blocked = () => act.blockers().filter((x) => !x.startsWith('the sequence'));
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Board
        </Typography>
        <Show
          when={s.repl()}
          fallback={
            <Stack spacing={1}>
              <Typography variant="body2">
                Plug in a Tiny Tapeout dev board (RP2350) and connect. Close the commander app first: only one page can
                use the board at a time.
              </Typography>
              <Button variant="contained" onClick={() => s.connect()} disabled={busy()}>
                Connect to a board
              </Button>
              <Show when={act.savedBackup()}>
                <Alert severity="info">
                  A backup of /demo.json and config.ini from {act.savedBackup()!.saved} is kept in this browser: connect
                  and restore it after flashing.
                </Alert>
              </Show>
            </Stack>
          }
        >
          <Show when={b()} fallback={<Typography variant="body2">Reading the board…</Typography>}>
            {(info) => (
              <Stack spacing={1}>
                <Row label="Chip">
                  <b>{info().isFpga ? 'FPGA board' : (info().shuttle ?? 'unknown')}</b> <span style={{ opacity: 0.7 }}>{romText(info())}</span>
                </Row>
                <Row label="Firmware">
                  SDK {info().sdk ?? 'unknown'}{' '}
                  <Show when={upgradeAvailable(info().sdk)}>
                    <Link href={STOCK_RELEASE_URL} target="_blank">
                      (upgrade to {LATEST_STOCK} available)
                    </Link>
                  </Show>
                </Row>
                <Row label="Projects">{info().projects ?? '?'} on this chip</Row>
                <Row label="Type">
                  <Chip size="small" color="primary" label={FIRMWARE[info().firmware].label} />
                </Row>
                <Typography variant="caption">{FIRMWARE[info().firmware].about}</Typography>
                <Row label="Demo mode">
                  {info().demoSetting ? 'on (demo = yes)' : 'off'}
                  {info().demoRunning || s.ramRunning() ? ', running now' : ''}
                  {s.ramRunning() ? ' (from RAM)' : ''}
                </Row>
                <For each={blocked()}>{(m) => <Alert severity="error">{m}</Alert>}</For>
                <Show when={info().demoErrors.length}>
                  <Alert severity="error">
                    The board&apos;s demo failed at boot:
                    <ul style={{ margin: 0 }}>
                      <For each={info().demoErrors}>{(e) => <li>{e}</li>}</For>
                    </ul>
                  </Alert>
                </Show>
                <Show when={info().demoJson !== null}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2">The board has a /demo.json.</Typography>
                    <Button size="small" onClick={() => act.openText(info().demoJson!, 'the board’s /demo.json')}>
                      Open it
                    </Button>
                  </Stack>
                </Show>

                <Divider />
                <Typography variant="subtitle2">Try it (nothing is written)</Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Button variant="contained" onClick={act.testInRam} disabled={busy() || act.blockers().length > 0}>
                    Run this sequence
                  </Button>
                  <Button onClick={act.stop} disabled={busy()}>
                    Stop
                  </Button>
                  <Button onClick={act.reboot} disabled={busy()}>
                    Reboot board
                  </Button>
                </Stack>

                <Divider />
                <Typography variant="subtitle2">On every power-up</Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Button variant="contained" color="secondary" onClick={act.makePermanent} disabled={busy() || act.blockers().length > 0}>
                    Make permanent
                  </Button>
                  <Button onClick={act.turnOff} disabled={busy() || !info().demoSetting}>
                    Turn demo off
                  </Button>
                  <Button color="error" onClick={act.resetToStock} disabled={busy()}>
                    Reset to stock
                  </Button>
                </Stack>

                <Divider />
                <Typography variant="subtitle2">Firmware</Typography>
                <Switch>
                  <Match when={info().firmware === 'handmade'}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Button onClick={act.importFromHandmade} disabled={busy()}>
                        Import its designs
                      </Button>
                      <Button onClick={act.installHelper} disabled={busy()}>
                        Replace with the helper
                      </Button>
                    </Stack>
                  </Match>
                  <Match when={info().firmware === 'stock'}>
                    <Button onClick={act.installHelper} disabled={busy()}>
                      Install the demo helper
                    </Button>
                  </Match>
                  <Match when={info().firmware === 'helper'}>
                    <Typography variant="body2">
                      &ldquo;Reset to stock&rdquo; removes the helper and puts the original main.py back.
                    </Typography>
                  </Match>
                </Switch>
                <Box>
                  <Typography variant="body2">
                    Flash firmware: save the board&apos;s files, reboot into the bootloader, then copy the .uf2 onto the
                    drive that appears.{' '}
                    <Link href={STOCK_RELEASE_URL} target="_blank">
                      Stock {LATEST_STOCK}
                    </Link>
                    {' · '}
                    <Link href={CUSTOM_FIRMWARE.url} target="_blank">
                      Demo-mode firmware {CUSTOM_FIRMWARE.released ? '' : '(not released yet: build from the branch)'}
                    </Link>
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Button size="small" onClick={act.backupBoardFiles} disabled={busy()}>
                      Save board files
                    </Button>
                    <Button size="small" onClick={act.bootloader} disabled={busy()}>
                      Reboot to bootloader
                    </Button>
                    <Show when={act.savedBackup()}>
                      <Button size="small" onClick={act.restoreBackup} disabled={busy()}>
                        Restore saved files
                      </Button>
                    </Show>
                  </Stack>
                </Box>
                <Divider />
                <Button size="small" onClick={() => s.disconnect()}>
                  Disconnect
                </Button>
              </Stack>
            )}
          </Show>
        </Show>
      </CardContent>
    </Card>
  );
}
