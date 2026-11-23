// SPDX-License-Identifier: Apache-2.0
// The connected board: what it is, how its demo mode is set up, and what can be done.
import { Alert, Box, Button, Card, CardContent, Chip, Divider, Link, Stack, Typography } from '@suid/material';
import { For, JSX, Match, Show, Switch } from 'solid-js';
import { BoardInfo, dieName, FirmwareType, unsupportedReason } from '~/lib/board';
import { CUSTOM_FIRMWARE, STOCK_FIRMWARE, upgradeFor } from '~/lib/firmware';
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

/** What to check after a Connect that didn't reach a board, by how it failed. */
function ConnectHelp() {
  const tips = (): { title: string; items: JSX.Element[] } | null => {
    switch (s.connectProblem()) {
      case 'none-chosen':
        return {
          title: 'No board was chosen. If Chrome’s list was empty (“No compatible devices found”), the browser can’t see the board’s serial port:',
          items: [
            <>Use a data USB cable (some only carry power), and try another port. The board should appear in <code>lsusb</code> as <code>2e8a:0005</code>.</>,
            <>On Linux, check a port exists: <code>ls -l /dev/ttyACM*</code>. If not, run <code>sudo dmesg | tail</code> after plugging in (the cdc_acm driver should attach).</>,
            <>Chrome or Chromium installed as a Snap or Flatpak can’t see serial ports. Snap: <code>sudo snap connect chromium:raw-usb</code>; Flatpak: <code>flatpak override --user --device=all com.google.Chrome</code>; then restart the browser. Chrome from google.com (.deb/.rpm) works as is.</>,
            <>Close anything else using the board (the commander app in another tab, Thonny, mpremote, screen), then try again.</>,
            <>
              If the port works from a terminal (<code>mpremote</code> gets a prompt) but Chrome lists nothing, Chrome may
              not know the port&apos;s USB IDs, which hides it from the board filter:{' '}
              <Button size="small" variant="outlined" onClick={() => void s.connect(true)}>
                Show every serial port
              </Button>{' '}
              and pick <code>ttyACM0</code> (or the board&apos;s name).
            </>,
          ],
        };
      case 'open-failed':
        return {
          title: 'The board was found but its serial port couldn’t be opened:',
          items: [
            <>Close anything else using it: the commander app (in any tab), Thonny, mpremote, screen, minicom.</>,
            <>On Linux you may lack permission: <code>groups</code> should list <code>dialout</code>; if not, <code>sudo usermod -aG dialout $USER</code> and log in again.</>,
            <>Unplug the board, plug it back in, and press Connect again.</>,
          ],
        };
      case 'no-repl':
        return {
          title: 'The port opened but the board didn’t answer as MicroPython:',
          items: [
            <>Press the board’s RESET button, wait a few seconds, and press Connect again.</>,
            <>If the message says the board keeps printing, something else is talking to it: close the commander app, Thonny or mpremote, or another tab using this app.</>,
            <>If it still fails, the board may not have the Tiny Tapeout MicroPython firmware: flash the stock firmware (hold BOOT while plugging in, then copy the .uf2 onto the drive).</>,
          ],
        };
      default:
        return null;
    }
  };
  return (
    <Show when={tips()}>
      {(t) => (
        <Alert severity="info">
          {t().title}
          <ul style={{ margin: '4px 0 0', 'padding-left': '18px' }}>
            <For each={t().items}>{(i) => <li>{i}</li>}</For>
          </ul>
        </Alert>
      )}
    </Show>
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
                Not connected. Plug in a Tiny Tapeout demoboard and press <b>Connect</b> at the top to test a
                sequence on it or install it. Close the commander app first: only one page can use the board.
              </Typography>
              <Typography variant="caption">
                Both kinds work: the <b>Tiny Tapeout Demoboard: ETR</b> (RP2350, firmware SDK 3.x) and the RP2040
                demoboards of TT04–TT08 (e.g. &ldquo;TinyTapeout 06+ Demoboard&rdquo;, firmware SDK 2.0.x). So does
                the FPGA board (an RP2350 demoboard with an FPGA breakout in place of the chip): its designs are the
                bitstreams on it.
              </Typography>
              <ConnectHelp />
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
                  <Show
                    when={!info().isFpga}
                    fallback={
                      <>
                        <b>FPGA board</b> <span style={{ opacity: 0.7 }}>(an FPGA breakout in place of a chip)</span>
                      </>
                    }
                  >
                    <b>{info().shuttle ?? 'unknown'}</b>
                    <Show when={dieName(info())}>{(d) => <b> · {d()}</b>}</Show>{' '}
                    <span style={{ opacity: 0.7 }}>{romText(info())}</span>
                  </Show>
                </Row>
                <Row label="Controller">{info().machine || 'unknown'}</Row>
                <Row label="Firmware">
                  SDK {info().sdk ?? 'unknown'}{' '}
                  <Show when={!info().isFpga && upgradeFor(info().mcu, info().sdk)}>
                    {(fw) => (
                      <Link href={fw().url} target="_blank">
                        (upgrade to {fw().latest} available: {fw().uf2})
                      </Link>
                    )}
                  </Show>
                </Row>
                <Show
                  when={!unsupportedReason(info())}
                  fallback={
                    <Alert severity="warning">
                      <b>This board can&apos;t be configured here.</b> {unsupportedReason(info())}
                    </Alert>
                  }
                >
                <Row label="Projects">
                  {info().projects ?? '?'} {info().isFpga ? 'bitstreams in /bitstreams' : 'on this chip'}
                </Row>
                <Show when={info().isFpga}>
                  <Alert severity="info">
                    On the FPGA board a design is a bitstream in <code>/bitstreams</code>, and a sequence picks it by its place in
                    the firmware’s list of them (0 is the first). Adding or removing a bitstream can renumber the others, and a
                    permanent sequence would then show other designs. While a demo runs the board drives <code>ui_in</code>{' '}
                    (ASIC_RP_CONTROL mode; its firmware starts in a mode that doesn’t), and each switch takes about 1.5 s to
                    load the next bitstream.
                  </Alert>
                </Show>
                <Row label="Type">
                  <Chip size="small" color="primary" label={FIRMWARE[info().firmware].label} />
                </Row>
                <Typography variant="caption">{FIRMWARE[info().firmware].about}</Typography>
                <Row label="Demo mode">
                  {info().demoSetting ? 'on (demo = yes)' : 'off'}
                  {info().demoRunning || s.ramRunning() ? ', running now' : ''}
                  {s.ramRunning() ? ' (from RAM)' : ''}
                </Row>
                <Row label="DIP switches">
                  {info().dipOn === null ? 'unknown' : info().dipOn!.length ? `ON: ${info().dipOn!.map((i) => `ui_in[${i}]`).join(', ')}` : 'all off (correct)'}
                </Row>
                <For each={blocked()}>{(m) => <Alert severity="error">{m}</Alert>}</For>
                <For each={act.setupWarnings()}>{(m) => <Alert severity="warning">{m}</Alert>}</For>
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
                    <Show when={info().isFpga}>
                      <b>
                        Flashing replaces every file, the bitstreams in /bitstreams too (“Save board files” keeps only
                        /demo.json and config.ini): copy them off first.
                      </b>{' '}
                    </Show>
                    <Link href={STOCK_FIRMWARE[info().mcu!].url} target="_blank">
                      Stock {STOCK_FIRMWARE[info().mcu!].latest} ({STOCK_FIRMWARE[info().mcu!].uf2})
                    </Link>
                    <Show when={info().mcu === CUSTOM_FIRMWARE.mcu}>
                      {' · '}
                      <Link href={CUSTOM_FIRMWARE.url} target="_blank">
                        Demo-mode firmware {CUSTOM_FIRMWARE.released ? '' : '(not released yet: build from the branch)'}
                      </Link>
                    </Show>
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
                </Show>
              </Stack>
            )}
          </Show>
        </Show>
      </CardContent>
    </Card>
  );
}
