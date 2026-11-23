# SPDX-License-Identifier: Apache-2.0
"""Make the SDK 2.x (RP2040) helper module from the pinned SDK 3.x one.

usage: uv run --no-project scripts/port-demo-sdk2.py src/data/demo.py src/data/demo-sdk2.py

Every change is an exact text replacement that must match once, so a new pinned
demo.py that moves any of them fails loudly instead of porting half-way. Pass "-"
as the output to print the result (the tests check it matches the committed file).
"""
import pathlib
import sys

src = pathlib.Path(sys.argv[1]).read_text()
out = src

def sub(old, new, count=1):
    global out
    assert out.count(old) == count, (old, out.count(old))
    out = out.replace(old, new)

sub("""# Pinned copy of ttboard/demo.py from mithro/tt-micropython-firmware
# branch demo-shuttle-sequences, commit 1c93680 (LGPL-2.1, like the firmware).
# Installed on stock firmware as the top-level module /demo.py.
""", """# ttboard/demo.py from mithro/tt-micropython-firmware branch
# demo-shuttle-sequences, commit 1c93680 (LGPL-2.1, like the firmware),
# ported to SDK 2.x (the RP2040 demoboards: TT04/05 and TT06+, SDK v2.0.x).
# Installed on stock 2.x firmware as the top-level module /demo.py.
#
# Only three things differ from the SDK 3.x copy (src/data/demo.py), and a
# test checks that everything else is identical:
#  - SDK 2.x calls its platform flag IsRP2040 (3.x: IsRP2);
#  - the RP2040 demoboards have no RP-driven LED (3.x: GPIOMapTTDBv3.RP_LED),
#    so the error display is the 7-segment "E" alone;
#  - boot_button_held() is left out: it reads the DBv3 pin map, and the
#    helper's main.py never calls it (it passes button_held=False). The
#    docstring and log message that mention the button say so instead.
""")
sub("""        Build tt.demo and start it if config.ini's "demo" setting, flipped
        by the boot button, says so.""", """        Build tt.demo and start it if config.ini's "demo" setting, flipped
        when button_held is true, says so (the helper passes False: there
        is no boot-button check on SDK 2.x).""")
sub("""            log.info('Demo: reset button held, skipping the demo for this boot')""",
    """            log.info('Demo: button_held, skipping the demo for this boot')""")
sub("""Turning it on: "demo = yes" in config.ini's [DEFAULT] section.  Holding
the project reset button while the board powers up flips that setting
for one boot (see boot_button_held() and main.py).
""", """Turning it on: "demo = yes" in config.ini's [DEFAULT] section.
""")
sub("""# ttboard.pins.upython only exports Timer from SDK 3.0.8 on; boards in the
# field still run 3.0.7, so pick it the same way upython picks Pin.
from ttboard.util.platform import IsRP2
if IsRP2:
""", """# SDK 2.x's ttboard.pins.upython has no Timer, so pick it the same way
# upython picks Pin.
from ttboard.util.platform import IsRP2040
if IsRP2040:
""")
start = out.index("def boot_button_held(")
end = out.index("def autostart(")
out = out[:start] + out[end:]
sub("""        if self._led is None:
            try:
                from ttboard.pins.upython import Pin
                from ttboard.pins.gpio_map_dbv3 import GPIOMapTTDBv3
                self._led = Pin(GPIOMapTTDBv3.RP_LED, Pin.OUT)
            except Exception as e:
                log.error(f'Demo: no LED for the error display ({e})')
""", "")
sub("""        Makes a demo error visible on a board nobody is watching the logs
        of: blinks "E" on the 7-segment display and the RP's LED.
""", """        Makes a demo error visible on a board nobody is watching the logs
        of: blinks "E" on the 7-segment display (and an LED, if one is
        passed in: the RP2040 demoboards have none of their own).
""")
sub("""        can't be set up, the LED still blinks.  Enabling""", """        can't be set up, only the log has them.  Enabling""")
sub("""            log.error(f'Demo: no 7-segment error display ({e}), using the LED only')""",
    """            log.error(f'Demo: no 7-segment error display ({e})')""")
if sys.argv[2] == "-":
    sys.stdout.write(out)
else:
    pathlib.Path(sys.argv[2]).write_text(out)
