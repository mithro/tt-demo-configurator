// SPDX-License-Identifier: Apache-2.0
// Python that installs a stand-in for the firmware's ttboard package in the CPython fake
// board, enough for detect.py: DemoBoard.get() with a shuttle, chip ROM and version,
// and the config.ini parser's [DEFAULT] lookup.
export function stubTtboard(
  opts: { shuttle?: string; projects?: number; firmwareDemo?: boolean; sdk?: string; index?: { projects: object[] } } = {},
) {
  const { shuttle = 'ttsky25a', projects = 237, firmwareDemo = false, sdk = '3.1.1', index = { projects: [] } } = opts;
  return `
import sys, types
sys.implementation._machine = 'Raspberry Pi Pico2 with RP2350'
for name in ('ttboard', 'ttboard.demoboard', 'ttboard.config', 'ttboard.config.parser', 'ttboard.util',
             'ttboard.util.platform', 'ttboard.util.time', 'ttboard.log', 'ttboard.pins', 'ttboard.pins.desktop_pin', 'ttboard.mode'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['ttboard.util.platform'].IsRP2 = False
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
            self.by_key[f"{p['address']}-{sub}" if sub else int(p['address'])] = _Design(p, self)
    def get(self, key):
        if key not in self.by_key: raise AttributeError('Unknown project (%s)' % key)
        return self.by_key[key]
    def __len__(self): return ${projects}
class _Port:
    value = 0
class _ROM:
    contents = {'shuttle': ${JSON.stringify(shuttle)}, 'repo': 'TinyTapeout/x', 'commit': 'abcd1234'}
class _TT:
    version = ${JSON.stringify(sdk)}
    shuttle = _Shuttle()
    chip_ROM = _ROM()
    ui_in = _Port()
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
