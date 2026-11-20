# Tiny Tapeout demo configurator: design

Date: 2026-11-20. Status: draft for approval.

## Why

A Tiny Tapeout dev board connected to a screen at a conference or convention booth should be
visually interesting by itself and draw people to the table. With no computer attached, it should
cycle through a chip's VGA designs, and play the games among them with scripted button presses.

For the Shenzhen open-silicon meetup (2026-11-11) this was done by hand, board by board, in one
Claude session (`dd706aa5` on tim-yoga, `~/local/tt-vga-cycle{,-2,-3,-4}`). Each board got a stock
`main.py` with `import vga_cycle; vga_cycle.run(tt)` appended, plus a `vga_cycle.py` holding a list of
`(macro, ui_in[, player])`. The workflow was:
1. List the chip's VGA designs.
2. Show each one on the monitor and decide whether to include it.
3. Write the files and back up the stock ones.
4. For three games, simulate button presses.

This app makes that workflow repeatable by anyone, from a web page, without writing code.

## Goals

- Connect to a dev board the way the Tiny Tapeout commander app does (WebSerial, MicroPython raw REPL).
- Detect:
  - the chip, using the ROM shuttle and commit (e.g. TTP2 `7416232b` versus power-gated TTPG `ff701baa`);
  - the FPGA emulation board;
  - the firmware type and version.
- Build a demo sequence for a chip:
  - choose designs, with easy sorting, filtering and search, for example by Pmod;
  - set each design's duration, clock and idle `ui_in`;
  - give it a fixed input script (`steps`).
- Preview the sequence with no board attached (simulation or recorded videos).
- Test the sequence live on a board without changing how it boots.
- Make it permanent, so the board runs the demo on every power-up with no computer.
- Turn demo mode on and off, and return the board to 100% stock.
- Read an existing `/demo.json` from a board or a file and show its configuration.
- Ship good ready-made demo files for each shuttle.

## Non-goals (v1)

- Gamepad Pmod emulation. This is planned for v2. In v1 all inputs are direct `ui_in` writes, which is
  what all three real game demos used.
- Holding sequences for several chips on one board, so it still works when the daughterboard is swapped
  (the later "demo board" idea). The file format allows it later, since each file names its shuttle.
- RP2040-era boards with firmware older than the 3.x SDK.
- Flashing firmware from the browser. Like the commander, the app links to the `.uf2` and helps the
  user get the board into bootloader mode.

## Anti-goals

- **A board that silently does the wrong thing.** An invalid configuration must fail loudly, never
  skip or carry on.
- **Breaking the board's normal use.** The commander app and the REPL must keep working while a
  demo runs, and "reset to stock" must really restore stock.
- **More than one way to express anything in the file format.** (Tim's rule: one representation per
  thing.)

## The three parts, and who owns them

| Part | What | Owner |
|---|---|---|
| (a) | Creating demo sequences: this web app | this repo |
| (b) | Entering and leaving demo mode | (b1) the firmware; (b2) a helper that this app installs on stock firmware |
| (c) | Default demo sequences per shuttle, shipped in the firmware | the firmware (release process) |

(b1) and (c) are being built by another session on `mithro/tt-micropython-firmware` (branches
`demo-mode` and `demo-index-playlist`) and `mithro/tinytapeout-index` (`index-demo-flag`). Those branches
implement an earlier draft and are being updated to the format below.

### (b1) Firmware demo mode

- `config.ini` `[DEFAULT] demo = yes` turns demo mode on.
- Holding a key at boot (the hold-RST trigger) flips the setting for that one boot.
- With demo mode on, the board uses `/demo.json` if it exists, otherwise
  `/shuttles/<detected shuttle>.demo.json`.
- Starting any project by hand (REPL or commander) stops the demo.

### (b2) Helper on stock firmware

The app installs:
- `demo.py`, the runner, using only the SDK's public API (it has been verified from RAM on stock SDK 3.1.0);
- a wrapper `main.py` that runs the saved stock main (`main_stock.py`) and then starts the demo.

It reads the same `config.ini` setting and the same files, and behaves the same, except that there is no
boot-key trigger: the stock boot has already used the RST line by the time the wrapper runs. Tim accepts
this.

### (c) Default sequences

`/shuttles/<shuttle>.demo.json` files are bundled next to the existing chip index files. The same
curated files also ship inside this app as its ready-made sequences, so there is one set of files, used
in both places. Where they live and how they are built is decided with the firmware owner.

## The file format (shared by `/demo.json` and `/shuttles/<id>.demo.json`)

```json
{"version": 1,
 "shuttle": "ttsky25a",
 "projects": [
   {"address": 260, "subtile": 0, "duration_ms": 15000, "clock_hz": 25000000, "ui_in": 7,
    "steps": [{"set": 6}, {"wait_ms": 40}, {"set": 7}, {"wait_ms": 120},
              {"set": 3}, {"wait_ms": 40}, {"set": 7}, {"wait_ms": 250}]}]}
```

- `shuttle` must equal the shuttle read from the chip ROM.
- Every project entry is an object, and all six fields are required integers or a list:
  - `address` and `subtile` are the index `address` and `subtile_addr`, with `subtile` 0 for normal
    projects. Projects are identified ONLY this way. Names can't be used, because the firmware renames
    every `tt_um_wokwi_*` project, and stock firmware can already look a project up by address.
  - `duration_ms` is how long the design is shown.
  - `clock_hz` is the project clock.
  - `ui_in` is the value set when the design starts.
  - `steps` is the input script, with `[]` meaning no inputs.
- A step is exactly one of `{"set": <int>}` (write that value to `ui_in`) or `{"wait_ms": <int>}`.
- When a non-empty `steps` runs out: reset the project and start again at step 1. `ui_in` is not
  re-applied, so a script starts with a `set` if it needs one. With empty steps there are no resets.
- There are no defaults, no inheritance and no optional fields. Unknown fields make the file invalid.
- **Invalid file means a loud failure.** If demo mode is on and the selected file is invalid, the board
  flashes an error pattern and logs every error to stdout and `boot.log`. Invalid means any of:
  - bad JSON;
  - a missing or wrongly-typed field;
  - a shuttle mismatch;
  - an unknown address or subtile;
  - a bad step;
  - an unknown field.
- **Open:** how the board shows the error. The TTDBv3 7-segment display is driven by the ASIC's `uo_out`,
  not by the RP2350. The firmware owner is to propose a mechanism (a project that mirrors `ui_in`, a
  bundled bitstream on FPGA, or the RP2350's own LED). The (b2) helper must do the same thing.

## The app

### Connecting and detecting

- Use the commander's connection method: WebSerial, then the raw REPL, then paste a small control
  script that prints `name=value` lines. Its `TTBoardDevice`, `ttcontrol.py` and `configIni.ts` are the
  starting point.
- On connect, show:
  - the chip: shuttle, ROM commit and its friendly name, or "FPGA";
  - the firmware: SDK version, plus a warning if the firmware can't load this chip's project list
    (seen on board `1efa3e18…`: ttsky25a chip, 0 projects);
  - the firmware type, one of:
    - **custom demo firmware** (the SDK has `tt.demo`);
    - **stock with helper** (`/demo.py` exists and `main.py` is the wrapper);
    - **stock without helper**;
  - whether demo mode is on (`config.ini`), and the board's `/demo.json` if it has one.
- Like the commander's "Upgrade available", the app offers to switch firmware type:
  - add or remove the helper (file writes);
  - flash the custom firmware, or flash the stock firmware: a link to the `.uf2`, plus a "reboot to
    bootloader" button (`machine.bootloader()`).
- Before any flash, the app saves `/demo.json` and `config.ini` and offers to write them back after.
  **To verify:** whether the release `.uf2` contains the filesystem image and so wipes these files.
  The stock boards' files are all dated 1970, which suggests it does.

### Building a sequence

- Choose the shuttle: from the connected board, or by hand when no board is connected.
- **Design list for that shuttle**, with these sources:
  - `index.tinytapeout.com` for titles, authors, pinouts and clocks;
  - the project-search database (`mith.ro/tinytapeout-project-search`) for inferred Pmod compatibility
    (tiny-vga, gamepad, audio, …), tags and silicon status;
  - the VGA-videos index (`data.wafer.space/big-storage/tinytapeout-vga-videos/`) for a thumbnail or
    video per design.
- Sort, filter and search, by Pmod first. The default view is "TinyVGA-compatible".
- **Walk-through mode**, copying the Shenzhen workflow: show designs one at a time (preview, or live
  on the board), with include or skip for each.
- **Per-entry editor**: `duration_ms`, `clock_hz` (pre-filled from the index, editable), `ui_in`, and
  a `steps` editor.
- **Step editor**: a list of `set` and `wait` rows. The `set` value is edited as an integer and as 8
  bit toggles labelled with the project's own `ui[n]` pin names from its pinout.
- **Loading** an existing `/demo.json`, from the board or a file, shows it in the same editor.
- **Saving**: to a file (download) and to the board.

### Preview without a board

- For designs with `steps: []` that have a recorded video: play the VGA-videos clip at real speed.
- For designs with steps, or with no video: simulate in a fork of vga-playground (`mithro/vga-playground`),
  and run the `steps` script against the simulation's `ui_in`. The fork adds an embed mode:
  load a project by repo and commit, set `ui_in`, reset, and report frames. It's used in an iframe or
  as a module. Expect slower than real time for large or fast designs. Some designs won't simulate,
  and those show "no preview".
- A timeline of the whole sequence, with each entry's duration.

### Testing on a board without changing boot

- Run the runner from RAM over the raw REPL, as the firmware session verified, with this `demo.json`.
  Nothing is written to flash. A reset returns the board to normal boot.
- Also offer "show this one design" and "play this one design's steps", like `show_one.sh` and
  `play_one.sh` from Shenzhen.

### Making it permanent, turning it off, resetting to stock

- **Make permanent**:
  1. Make sure the helper is installed, or the custom firmware is present.
  2. Write `/demo.json`.
  3. Set `config.ini` `demo = yes`, using the commander's line-based ini editing and allowing for the
     firmware parser's quirks.
- **Turn off**: set `demo = no`, and leave the files in place.
- **Reset to stock**:
  1. Remove `/demo.json`, `/demo.py` and the wrapper.
  2. Restore `main.py` from `main_stock.py`.
  3. Remove the `demo` line from `config.ini`.
  4. Confirm against the known stock file contents for that SDK version.

### Ready-made sequences

One per shuttle, curated, shared with (c). The first ones are the four Shenzhen boards:

| Shuttle | Designs |
|---|---|
| ttgf0p3 | 4 |
| ttsky25b | 7 |
| tt09 | 8 |
| ttsky25a | 14, including Crossyroad (907), Connect Four (260) and Shady Pong (674) |

The hand-made versions are kept in `~/github/TinyTapeout/tmp/yoga/local/` on big-storage. The three games
need fixed scripts written. The Shenzhen code used random players.

## Approaches considered

**How the demo runs on a stock-firmware board** (picked: wrapper `main.py` plus `demo.py`):
- **A wrapper `main.py`** that runs the saved stock main and then starts the demo. The board keeps
  stock behaviour, the REPL stays usable, and the stock main can be restored exactly.
- **A `boot.py` hook.** `boot.py` runs before `main.py`, so a loop there would block the SDK set-up and
  the REPL. Rejected as fragile.
- **Appending a line to the stock `main.py`**, as done by hand in Shenzhen. It works, but it edits a
  stock file, which makes reset-to-stock and version detection harder. Rejected in favour of the wrapper.

**How the demo is described**: a data file (`demo.json`) rather than generated Python (`vga_cycle.py`),
so that the same file works on stock and custom firmware, can be read back and shown, and can ship as a
default.

**Inputs**: a deterministic `set`/`wait_ms` script was chosen over random "players" (Tim: always the
same), and over a scripts-plus-random dual mode (one mechanism only).

**Preview**: recorded videos (real speed, but not the user's inputs) combined with in-browser
simulation (the user's inputs, but possibly slow). The choice per design is above.

## Decided by Tim

- The (a)/(b)/(c) split, (b1) versus (b2), and (c) as bundled demo files.
- There is exactly one `/demo.json`, used if it exists; otherwise the bundled default for the shuttle.
- The format rules: objects only, `*_ms` integers, no alternatives, deterministic `set`/`wait_ms` steps,
  reset when the steps run out, address plus subtile identification, the shuttle checked.
- Invalid files fail loudly.
- No boot-key trigger on stock firmware is fine.
- Gamepad emulation is v2.
- Detecting and switching firmware type works the way the commander offers upgrades.
- Offline mode with preview from vga-playground and the videos. A fork of vga-playground is fine.

## Builder's calls (Claude's proposals, open to correction)

- **Stack**: SolidJS, SUID and Vite, matching the commander (`TinyTapeout/tt-commander-app`). Reuse its
  device and REPL code, theme (`#544ead` primary, `#8afbfd` secondary) and GitHub Pages deployment.
- **Licence**: Apache-2.0.
- **Repository**: `mithro/tt-demo-configurator`, local at `~/github/TinyTapeout/tt-demo-configurator`.
- The UI layout and the exact error-pattern visuals.

## Open items

1. How the error pattern is shown (firmware owner).
2. Whether flashing the release `.uf2` wipes the filesystem (verify).
3. A release process for the custom demo firmware `.uf2`, since only branches exist today (firmware owner).
4. Where the bundled per-shuttle default files live, and how the app and the firmware share them.
5. The fixed step scripts for Crossyroad, Connect Four and Shady Pong.
