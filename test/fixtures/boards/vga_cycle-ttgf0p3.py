'''
Cycle through the VGA designs on the ttgf0p3 chip, DWELL_S seconds each.

Started from main.py on power-up. Press Ctrl-C in the REPL to stop;
the 'tt' object is then available as usual.
'''
import time

# (macro, ui_in value) -- all VGA designs on ttgf0p3 using the TinyVGA Pmod
# pinout. ui_in = 0 leaves buttons released and debug/solid-colour modes off.
VGA_DESIGNS = [
    ('tt_um_a1k0n_nyancat', 0),
    ('tt_um_waferspace_vga_screensaver', 0),
    ('tt_um_combined', 0),               # Philippine flag waving
    ('tt_um_2048_vga_game', 0),
]

DWELL_S = 15
VGA_CLOCK_HZ = 25_175_000


def show(tt, macro, ui_in):
    print(f"VGA cycle: {macro}")
    getattr(tt.shuttle, macro).enable()
    tt.ui_in.value = ui_in
    # enable() normally starts the clock from the project's clock_hz;
    # make sure regardless.
    if not tt.is_auto_clocking:
        tt.clock_project_PWM(VGA_CLOCK_HZ)
    tt.reset_project(True)
    time.sleep_ms(10)
    tt.reset_project(False)


def run(tt, dwell_s=DWELL_S):
    designs = [(m, ui) for m, ui in VGA_DESIGNS if tt.shuttle.has(m)]
    if not designs:
        print(f"VGA cycle: no known VGA designs on {tt.shuttle.run}")
        return
    print(f"VGA cycle: {len(designs)} designs, {dwell_s}s each. Ctrl-C to stop.")
    try:
        while True:
            for macro, ui_in in designs:
                show(tt, macro, ui_in)
                time.sleep(dwell_s)
    except KeyboardInterrupt:
        print("VGA cycle: stopped")
