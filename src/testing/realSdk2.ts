// SPDX-License-Identifier: Apache-2.0
// The real Tiny Tapeout SDK 2.x (fetched into tmp/sdk2/ by scripts/fetch-sdk2.py) booted
// in the CPython fake board, standing in for an RP2040 demoboard. Only the hardware is
// faked, below the SDK: PWM (CPython has none), machine.Timer (the SDK's desktop stand-in
// has no Timer), the chip ROM's contents (the desktop pins read 0, so the ROM can't be
// read), and the MicroPython-only gc.threshold() and micropython module the stock main.py
// uses. Everything else, from main.py and config.ini down to the project mux, the
// shuttle index .bin and the pins, is the SDK's own code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const SDK2 = path.join(REPO, 'tmp', 'sdk2');

/** The SDK version fetched, or null if scripts/fetch-sdk2.py hasn't been run. */
export const sdk2Version: string | null = existsSync(path.join(SDK2, 'TAG')) ? readFileSync(path.join(SDK2, 'TAG'), 'utf8').trim() : null;

export const sdk2File = (rel: string) => readFileSync(path.join(SDK2, 'fw', rel), 'utf8');

/**
 * Put a stock SDK 2.x board's files into the fake board's root: the release's main.py
 * and config.ini, its release_v<version> marker, and a shuttle index for `shuttle` built
 * from `projects` the way the 2.x release builds it (the index fields it fetches, then
 * the SDK's own serializer for the .bin, which is run on the board).
 */
export function installStockSdk2(root: string, shuttle: string, projects: Record<string, unknown>[]) {
  mkdirSync(path.join(root, 'shuttles'), { recursive: true });
  writeFileSync(path.join(root, 'main.py'), sdk2File('src/main.py'));
  writeFileSync(path.join(root, 'config.ini'), sdk2File('src/config.ini'));
  writeFileSync(path.join(root, `release_v${sdk2Version}`), '');
  const fields = ['repo', 'address', 'commit', 'clock_hz', 'title', 'danger_level'];
  const index = {
    projects: projects
      // 2.x shuttles (tt04..tt08) have no groups or subtiles
      .filter((p) => p.type !== 'group' && !p.subtile_addr)
      .map((p) => ({
        macro: p.macro,
        ...Object.fromEntries(fields.filter((f) => f in p).map((f) => [f, p[f]])),
        title: p.title ?? p.macro,
        clock_hz: p.clock_hz ?? 0,
        repo: p.repo ?? '',
        commit: p.commit ?? '',
      })),
  };
  writeFileSync(path.join(root, 'shuttles', `${shuttle}.json`), JSON.stringify(index));
}

/**
 * Python for the fake board: forget everything (like a reset), fake the hardware, and run
 * /main.py as the board does at power-up. Run it again to "reboot".
 */
export function bootSdk2(rom: { shuttle: string; repo: string; commit: string }): string {
  const src = path.join(SDK2, 'fw', 'src');
  const mcotb = path.join(SDK2, 'microcotb', 'src');
  return `
import sys, gc, types
for _n in [n for n in sys.modules if n.split('.')[0] in ('ttboard', 'microcotb', 'demo')]:
    del sys.modules[_n]
for _k in [k for k in globals() if not k.startswith('__')]:
    del globals()[_k]
import sys, gc, types, json
for _p in (${JSON.stringify(mcotb)}, ${JSON.stringify(src)}):
    if _p not in sys.path: sys.path.insert(0, _p)
sys.implementation._machine = 'Raspberry Pi Pico with RP2040'
gc.threshold = lambda *a: -1
_mp = types.ModuleType('micropython')
_mp.mem_info = lambda *a: None
_mp.native = lambda f: f
sys.modules['micropython'] = _mp
import logging as _logging
_logging.disable(_logging.WARNING)  # keep the SDK's INFO chatter out of the test output
import os
try:
    os.remove('/shuttles/${rom.shuttle}.json.bin')
except OSError:
    pass
from ttboard.project_mux import DesignIndex as _DI
_DI(None, '/shuttles/${rom.shuttle}.json').to_bin_file('/shuttles/${rom.shuttle}.json.bin')
import ttboard.pins.standard as _st
class _PWM:
    def __init__(self, f): self.f = f
    def freq(self, v=None):
        if v is not None: self.f = v
        return self.f
    def deinit(self): pass
def _pwm(self, freq=None, duty_u16=0):
    if freq is not None and freq < 1:
        self._pwm = None
        return None
    self._pwm = _PWM(int(freq))
    return self._pwm
_st.StandardPin.pwm = _pwm
import ttboard.pins.desktop_pin as _dp
class _Timer:
    ONE_SHOT, PERIODIC = 0, 1
    def init(self, **k): self.k = k
    def deinit(self): self.k = None
_dp.Timer = _Timer
import ttboard.boot.rom as _rom
_rom.ChipROM.contents = property(lambda self: ${JSON.stringify(rom)})
for _v in ('_st', '_dp', '_rom', '_DI', '_mp', '_p', '_n', '_k', '_v'):
    globals().pop(_v, None)
exec(open('/main.py').read())
`;
}
