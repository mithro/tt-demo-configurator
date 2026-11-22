'''
Cycle through the VGA designs on the ttsky25b chip, DWELL_S seconds each.

Started from main.py on power-up. Press Ctrl-C in the REPL to stop;
the 'tt' object is then available as usual.
'''
import time

# (macro, ui_in value) -- VGA designs on ttsky25b using the TinyVGA Pmod
# pinout. ui_in = 0 leaves buttons released and debug/solid-colour modes off
# (and selects the TinyVGA pinout for tt_um_vga_clock).
VGA_DESIGNS = [
    ('tt_um_vga_clock', 0),                                # 192, 31.5 MHz via config.ini
    ('tt_um_tinytapeout_logo_screensaver', 0),             # 582
    ('tt_um_zerotoasic_logo_screensaver', 0),              # 588
    ('tt_um_rejunity_vga_playground', 0),                  # 452
    ('tt_um_bouncing_squares', 0),                         # 749
    ('tt_um_tiny_shader_v2_mole99', 0),                    # 584, 50.35 MHz
    ('tt_um_verilog_meetup_template_project_example', 0),  # 590
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
