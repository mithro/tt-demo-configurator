// SPDX-License-Identifier: Apache-2.0
// Python that installs a stand-in for the firmware's ttboard package in the CPython fake
// board, enough for detect.py: DemoBoard.get() with a shuttle, chip ROM and version,
// and the config.ini parser's [DEFAULT] lookup.
export function stubTtboard(opts: { shuttle?: string; projects?: number; firmwareDemo?: boolean; sdk?: string } = {}) {
  const { shuttle = 'ttsky25a', projects = 237, firmwareDemo = false, sdk = '3.1.1' } = opts;
  return `
import sys, types
sys.implementation._machine = 'Raspberry Pi Pico2 with RP2350'
for name in ('ttboard', 'ttboard.demoboard', 'ttboard.config', 'ttboard.config.parser'):
    sys.modules[name] = types.ModuleType(name)
class _Shuttle:
    run = ${JSON.stringify(shuttle)}
    def __len__(self): return ${projects}
class _ROM:
    contents = {'shuttle': ${JSON.stringify(shuttle)}, 'repo': 'TinyTapeout/x', 'commit': 'abcd1234'}
class _TT:
    version = ${JSON.stringify(sdk)}
    shuttle = _Shuttle()
    chip_ROM = _ROM()
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
