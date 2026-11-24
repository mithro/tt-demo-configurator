// SPDX-License-Identifier: Apache-2.0
// Python that installs a stand-in for the firmware's ttboard package in the CPython fake
// board, enough for detect.py: DemoBoard.get() with a shuttle, chip ROM and version,
// and the config.ini parser's [DEFAULT] lookup.
//
// mcu 'RP2040' stands in for an RP2040 demoboard on SDK 2.x where the two differ in what
// the app uses: the platform flag is IsRP2040 (3.x: IsRP2), and project lookups take
// only addresses (2.x shuttle indexes have no subtiles).
//
// fpga (bitstream names, in the order the board lists /bitstreams) stands in for the FPGA
// breakout board, as SDK 3.1.0's FPGAMux and BitStreamIndex behave: shuttle "FPGA", a
// design per bitstream addressed by its position in that listing (or by name), enable()
// returning None, and a ROM with empty repo and commit. As on the real board, the SDK
// forces ASIC_MANUAL_INPUTS mode at start-up, and in that mode a ui_in write never
// reaches the design (the RP2350 doesn't drive the pins): ui_in reads 0.
import type { Mcu } from '~/lib/firmware';

export function stubTtboard(
  opts: {
    mcu?: Mcu;
    shuttle?: string;
    projects?: number;
    firmwareDemo?: boolean;
    sdk?: string;
    index?: { projects: object[] };
    fpga?: string[];
  } = {},
) {
  const { mcu = 'RP2350', firmwareDemo = false, index = { projects: [] }, fpga } = opts;
  const sdk2 = mcu === 'RP2040';
  const { shuttle = fpga ? 'FPGA' : sdk2 ? 'tt07' : 'ttsky25a', sdk = sdk2 ? '2.0.4' : fpga ? '3.1.0' : '3.1.1' } = opts;
  const projects = opts.projects ?? (fpga ? fpga.length : 237);
  return `
import sys, types
sys.implementation._machine = ${JSON.stringify(sdk2 ? 'Raspberry Pi Pico with RP2040' : 'Raspberry Pi Pico2 with RP2350')}
for name in ('ttboard', 'ttboard.demoboard', 'ttboard.config', 'ttboard.config.parser', 'ttboard.util',
             'ttboard.util.platform', 'ttboard.util.time', 'ttboard.log', 'ttboard.pins', 'ttboard.pins.desktop_pin', 'ttboard.mode',
             'ttboard.pins.upython'):
    sys.modules[name] = types.ModuleType(name)
setattr(sys.modules['ttboard.util.platform'], ${JSON.stringify(sdk2 ? 'IsRP2040' : 'IsRP2')}, False)
sys.modules['ttboard.util.time'].sleep_ms = lambda ms: None
sys.modules['ttboard'].util = sys.modules['ttboard.util']
sys.modules['ttboard.util'].time = sys.modules['ttboard.util.time']
class _Log:
    def __getattr__(self, name): return lambda *a: print('LOG', name, *a)
sys.modules['ttboard.log'].getLogger = lambda n: _Log()
class Timer:
    ONE_SHOT, PERIODIC = 0, 1
    def init(self, **k): self.k = k
    def deinit(self): pass
sys.modules['ttboard.pins.desktop_pin'].Timer = Timer
class _Design:
    def __init__(self, p, mux): self.name, self.p, self.mux = p['macro'], p, mux
    danger_level = property(lambda self: 0 if self.p.get('danger_level', 'safe') == 'safe' else 2)
    def enable(self):
        self.mux.enabled = self
        if self.mux.design_enabled_callback: self.mux.design_enabled_callback(self)
class _Shuttle:
    run = ${JSON.stringify(shuttle)}
    enabled = None
    design_enabled_callback = None
    def __init__(self):
        self.by_key = {}
        for p in __import__('json').loads(${JSON.stringify(JSON.stringify(index.projects))}):
            if p.get('type') == 'group': continue
            sub = int(p.get('subtile_addr', 0))
            if sub and ${sdk2 ? 'True' : 'False'}: continue
            self.by_key[f"{p['address']}-{sub}" if sub else int(p['address'])] = _Design(p, self)
    def get(self, key):
        if key not in self.by_key: raise AttributeError('Unknown project (%s)' % key)
        return self.by_key[key]
    def __len__(self): return ${projects}
class _BitStream:
    def __init__(self, mux, name, pid): self.mux, self.name, self.project_index, self.clock_hz = mux, name, pid, 100
    file = property(lambda self: '/bitstreams/%s.bin' % self.name)
    def enable(self, force=False):
        # like ttboard.fpga.fpga_mux.BitStream: returns None, even though it loaded
        self.mux.enable(self, force)
class _BitStreamIndex:
    def __init__(self, mux, names): self.all = [_BitStream(mux, n, i) for i, n in enumerate(names)]
class _FPGAMux:
    run = 'FPGA'
    enabled = None
    design_enabled_callback = None
    def __init__(self): self.projects = _BitStreamIndex(self, __import__('json').loads(${JSON.stringify(JSON.stringify(fpga ?? []))}))
    def enable(self, design, force=False):
        self.enabled = design
        if self.design_enabled_callback is not None: self.design_enabled_callback(design)
        return True
    def get(self, name):
        try:
            asint = int(name)
            if 0 <= asint < len(self.projects.all): return self.projects.all[asint]
            raise ValueError(f'Do not have a project {asint}')
        except ValueError:
            pass
        for b in self.projects.all:
            if b.name == name: return b
        raise ValueError(f'Do not have a project "{name}"')
    def __getattr__(self, name):
        for b in self.projects.all:
            if b.name == name: return b
        raise AttributeError(f"What is '{name}'?")
    def __len__(self): return len(self.projects.all)
class RPMode:
    SAFE, ASIC_RP_CONTROL, ASIC_MANUAL_INPUTS = 0, 1, 2
    @classmethod
    def to_string(cls, m): return {0: 'SAFE', 1: 'ASIC_RP_CONTROL', 2: 'ASIC_MANUAL_INPUTS'}[m]
sys.modules['ttboard.mode'].RPMode = RPMode
class _UiIn:
    # ui_in: what the RP2350 drives, and only in ASIC_RP_CONTROL mode
    def __init__(self): self._v = 0
    def _get(self): return self._v if DemoBoard._tt.mode == RPMode.ASIC_RP_CONTROL else 0
    def _set(self, v):
        if DemoBoard._tt.mode == RPMode.ASIC_RP_CONTROL: self._v = v
    value = property(_get, _set)
class Pin:
    IN, OUT = 0, 1
sys.modules['ttboard.pins.upython'].Pin = Pin
class _UiPin:
    # a ui_in pin: driven by the RP2350 (mode OUT) unless its DIP switch is on
    def __init__(self): self.switch, self.mode, self.out = 0, Pin.OUT, 0
    is_input = property(lambda self: self.mode == Pin.IN)
    def __call__(self, v=None):
        if v is not None: self.out = v
        return self.switch if self.is_input else self.out
class _Pins:
    def __init__(self):
        for i in range(8): setattr(self, 'ui_in%d' % i, _UiPin())
class _ROM:
    contents = {'shuttle': ${JSON.stringify(shuttle)}, 'repo': 'TinyTapeout/x', 'commit': 'abcd1234'}
class _FPGAROM:
    # ttboard.boot.shuttle_properties.HardcodedShuttle('FPGA'): no contents
    shuttle, repo, commit = 'FPGA', '', ''
class _TT:
    version = ${JSON.stringify(sdk)}
    shuttle = ${fpga ? '_FPGAMux()' : '_Shuttle()'}
    chip_ROM = ${fpga ? '_FPGAROM()' : '_ROM()'}
    ui_in = _UiIn()
    pins = _Pins()
    mode = ${fpga ? 'RPMode.ASIC_MANUAL_INPUTS' : 'RPMode.ASIC_RP_CONTROL'}
    mode_str = property(lambda self: RPMode.to_string(self.mode))
    clock = None
    def clock_project_PWM(self, hz): self.clock = hz
    def clock_project_stop(self): self.clock = 0
    def reset_project(self, on): pass
class DemoBoard:
    _tt = _TT()
    @classmethod
    def get(cls): return cls._tt
sys.modules['ttboard.demoboard'].DemoBoard = DemoBoard
class ConfigParser:
    def read(self, path):
        self.on = False
        try:
            with open(path) as f:
                section = 'DEFAULT'
                for line in f:
                    line = line.strip()
                    if line.startswith('['): section = line.strip('[]')
                    elif section == 'DEFAULT' and line.replace(' ', '') == 'demo=yes': self.on = True
        except OSError:
            pass
    def get(self, section, option): return self.on if option == 'demo' else None
sys.modules['ttboard.config.parser'].ConfigParser = ConfigParser
${firmwareDemo ? "sys.modules['ttboard.demo'] = types.ModuleType('ttboard.demo')" : ''}
`;
}
