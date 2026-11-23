# Tiny Tapeout Demo Configurator

A web page for turning a [Tiny Tapeout](https://tinytapeout.com) dev board into a booth demo:
with a screen plugged into its VGA Pmod and no computer attached, the board cycles through
the chip's VGA designs and plays the games among them with scripted button presses.

**Use it:** https://mith.ro/tt-demo-configurator/ (Chrome or Edge on a desktop: it
talks to the board over WebSerial).

- Pick designs for a chip, filtered by Pmod (Tiny VGA by default), with each design's
  recorded video from the [Tiny Tapeout VGA videos](https://data.wafer.space/big-storage/tinytapeout-vga-videos/).
- Set each design's time on screen, clock, starting `ui_in`, and a fixed input script.
- Preview the sequence without a board, try it on a board from RAM (nothing written), then
  make it permanent, turn it off, or put the board back to exactly stock.
- Or simulate it: the preview's **Simulation** switch fetches each design's Verilog from
  its repository (at the commit on the chip), compiles it in the browser with the
  [VGA Playground](https://github.com/TinyTapeout/vga-playground)'s Verilator/WebAssembly
  engine, and draws what a 640x480 monitor would show, with the entry's `ui_in` and steps
  (usually slower than real time; the preview says how fast it runs).
- Works with the stock firmware (it installs a small helper) and with the demo-mode firmware.
- Works with both kinds of demoboard: the RP2350 **Tiny Tapeout Demoboard: ETR** (firmware
  SDK 3.x) and the RP2040 demoboards of TT04 to TT08 (e.g. "TinyTapeout 06+ Demoboard",
  SDK 2.0.0 to 2.0.4).
- And with the **FPGA board**: an RP2350 demoboard with an FPGA breakout in place of the chip,
  whose designs are the bitstreams on the board (see below).
- Ready-made sequences for the four boards shown at the Shenzhen open-silicon meetup (2026-11).

## The demo.json format

The board runs `/demo.json`, or the firmware's bundled `/shuttles/<shuttle>.demo.json`:

```json
{"version": 1, "shuttle": "ttsky25a", "projects": [
  {"address": 260, "subtile": 0, "duration_ms": 30000, "clock_hz": 25000000, "ui_in": 7,
   "steps": [{"set": 5}, {"wait_ms": 40}, {"set": 7}, {"wait_ms": 120}]}]}
```

Every field is required and there is one way to write each thing. A step is
`{"set": 0..255}` (write `ui_in`) or `{"wait_ms": N}`; when the steps run out the project is
reset and they start again. An invalid file never runs partly: the board logs every problem
and blinks **E** on the 7-segment display. The full description is
[demo.md](https://github.com/mithro/tt-micropython-firmware/blob/demo-shuttle-sequences/demo.md)
in the firmware.

## The FPGA board

The FPGA board's firmware reports the shuttle `FPGA`, and there is no index of its designs:
they are the bitstreams in its `/bitstreams`. The SDK (3.1.0) numbers them by their place in
its listing of that directory, and that number is the `address` in `/demo.json` (`subtile` is
0); the demo runner looks them up exactly as on a chip, and each switch loads the next
bitstream (about 1.4 s). So the app reads the design list from the connected board, and a
bitstream named like a Tiny Tapeout project (e.g. `tt_um_factory_test`) is shown with that
project's details, recording and simulation sources; the others only with their names.

- Adding or removing a bitstream can renumber the others, and a permanent sequence would then
  show other designs. The app says which bitstream each address is before making it permanent.
  A sequence made for one FPGA board is only right for another with the same bitstreams.
- The SDK starts the FPGA board in `ASIC_MANUAL_INPUTS` mode whatever `config.ini` says, and
  then the RP2350 doesn't drive `ui_in`. A demo run from the app, and the helper at boot when
  demo mode is on, switch the board to `ASIC_RP_CONTROL` first. The demo-mode firmware doesn't
  (yet), so on it the designs don't get their inputs after a power-up.
- Flashing firmware replaces every file, the bitstreams too.

## How it works with the board's firmware

| Board | Demo mode comes from |
|---|---|
| Demo-mode firmware | built in: `config.ini` `demo = yes`; hold RST at power-up to flip it for one boot |
| Stock firmware | the helper this app installs: `/demo.py`, and a `/main.py` that runs the original (kept as `/main_stock.py`) and then the demo |

`/demo.py` is a pinned copy of the firmware's `ttboard/demo.py` (LGPL-2.1, like the firmware),
in `src/data/demo.py`. RP2040 boards get its port to SDK 2.x, `src/data/demo-sdk2.py`, made
from it by `scripts/port-demo-sdk2.py` (three small changes; a test checks nothing else
differs). The demo-mode firmware is RP2350 only.

| Microcontroller | SDK | Stock firmware |
|---|---|---|
| RP2350 (Demoboard: ETR) | 3.0.0 to 3.1.1 | [v3.1.1](https://github.com/TinyTapeout/tt-micropython-firmware/releases/tag/v3.1.1), `tt-demo-rp2350-v3.1.1.uf2` |
| RP2040 (TT04/05, TT06+ demoboards) | 2.0.0 to 2.0.4 | [v2.0.4](https://github.com/TinyTapeout/tt-micropython-firmware/releases/tag/v2.0.4), `tt-demo-rp2040-v2.0.4.uf2` (the last RP2040 release) |

## Development

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests; some run board-side Python in CPython (needs uv)
npm run build
```

On real boards, through an [fpgas.online](https://tinytapeout.fpgas.online/) serial bridge:

- `npx vite-node scripts/hw-test.ts -- <ws-url> <shuttle> [--permanent] ...` runs the app's
  board code: detect, file transfer, the board's own check, a RAM run and, with
  `--permanent`, install, reboot and reset to stock, checking every file's SHA-256 is as
  before. FPGA boards: `... FPGA --designs=tt_um_counter_7seg:10:128,tt_um_vga_pattern:25175000`.
- `scripts/board-browser-check.py` drives the built app in Chromium against a board, with a
  stand-in `navigator.serial` whose port is the bridge (nothing is written).

Board-side code is tested without hardware: `test/fake_board.py` runs the Python the app
sends in CPython, with `/` mapped to a scratch directory. The validator's fixtures in
`test/fixtures/` carry the errors the firmware itself reports
(`scripts/firmware-errors.py`), so the app and the board agree word for word.

`src/testing/stubTtboard.ts` stands in for the SDK (3.x, or 2.x with `mcu: 'RP2040'`). For the
RP2040 boards there is also a test against the real SDK 2.x: `uv run --no-project
scripts/fetch-sdk2.py [tag]` puts it in `tmp/sdk2/`, and `src/lib/sdk2.real.test.ts` then
boots its stock `main.py` in the fake board (only PWM, timers and the chip ROM are faked)
and runs detect, validate, RAM runs, the helper and reset-to-stock against it. CI fetches
v2.0.4; without `tmp/sdk2/` the test is skipped.

Data refresh scripts:

- `scripts/update-videos.py`: the trimmed VGA-videos index (`src/data/videos.json`).
- `scripts/update-project-search.py`: per-shuttle Pmod matches, AI-written tags and silicon reports from the [project-search](https://mith.ro/tinytapeout-project-search/) database (`src/data/project-search/`).
- `scripts/update-stock-main.py`: the stock `main.py` of every SDK 2.x and 3.x release.
- `scripts/make-shenzhen-demos.py`: the ready-made sequences.
- `scripts/check-micropython.py`: compile the board-side Python with `mpy-cross`.

Simulator:

- `npm ci` runs `scripts/fetch-sim-engine.mjs`, which downloads the VGA Playground's
  simulator into `src/vendor/vga-playground/` (pinned commit, SHA-256 checked; see
  `src/vendor/README.md`).
- `npx vite-node scripts/sim-survey.ts -- ttsky25a tt08 ...`: how many of each shuttle's
  Tiny VGA designs compile and produce a picture.
- `scripts/sim-preview-check.py`: screenshots of the simulated preview in Chromium
  (Playwright; see its docstring).

Pushes to `main` are deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Licence

Apache-2.0, except `src/data/demo.py` and `src/data/demo-sdk2.py` (LGPL-2.1, from the
firmware), the stock `main.py` copies in `src/data/stock-main/` (the firmware's), and the
simulator engine fetched into `src/vendor/vga-playground/` (GPL-3.0; Verilator itself is
LGPL-3.0/Artistic-2.0). The deployed simulator worker bundles that GPL-3.0 code, which
the repository owner approved on 2026-11-23: see `src/vendor/README.md`.
