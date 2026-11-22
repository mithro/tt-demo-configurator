'''
Cycle through the VGA designs on the ttsky25a chip, DWELL_S seconds each.

Started from main.py on power-up. Press Ctrl-C in the REPL to stop;
the 'tt' object is then available as usual.

Games get a "player" that simulates button presses on ui_in while they
are shown, instead of sitting idle.
'''
import random
import time


def _until(deadline):
    return time.ticks_diff(deadline, time.ticks_ms()) > 0


def play_crossyroad(tt, dwell_s):
    # ui[0] move_btn, active high: holding it walks the chicken forward.
    # Hitting an obstacle restarts the game by itself, so move in short
    # bursts with longer pauses to give obstacles time to pass.
    deadline = time.ticks_add(time.ticks_ms(), dwell_s * 1000)
    while _until(deadline):
        tt.ui_in.value = 1
        time.sleep_ms(random.randint(100, 400))
        tt.ui_in.value = 0
        time.sleep_ms(random.randint(300, 1000))


C4_IDLE = 0b111            # ui[0] drop, ui[1] right, ui[2] left; active low


def _c4_press(tt, bit):
    tt.ui_in.value = C4_IDLE & ~(1 << bit)
    time.sleep_ms(40)
    tt.ui_in.value = C4_IDLE
    time.sleep_ms(120)


def play_connect_four(tt, dwell_s):
    # Random column moves then a drop. The game freezes on its win screen
    # until reset, so start a fresh game every 16 drops.
    deadline = time.ticks_add(time.ticks_ms(), dwell_s * 1000)
    drops = 0
    while _until(deadline):
        _c4_press(tt, random.choice((1, 2)))      # right or left
        for _ in range(random.randint(0, 3)):
            _c4_press(tt, random.choice((1, 2)))
        _c4_press(tt, 0)                          # drop
        drops += 1
        if drops >= 16:
            tt.reset_project(True)
            time.sleep_ms(10)
            tt.reset_project(False)
            drops = 0
        time.sleep_ms(250)


SP_IDLE = 0b1_1111         # ui[0..3] P1 up/down, P2 up/down (active low); ui[4] fallback speed


def play_shady_pong(tt, dwell_s):
    # Each paddle independently moves up, down or rests for a random time.
    deadline = time.ticks_add(time.ticks_ms(), dwell_s * 1000)
    until = [0, 0]
    pressed = [0, 0]       # bit mask of the pressed button for each player
    while _until(deadline):
        now = time.ticks_ms()
        for p in (0, 1):
            if time.ticks_diff(until[p], now) <= 0:
                pressed[p] = random.choice((0, 1, 2)) << (2 * p)   # rest, up, down
                until[p] = time.ticks_add(now, random.randint(100, 600))
        tt.ui_in.value = SP_IDLE & ~(pressed[0] | pressed[1])
        time.sleep_ms(20)


# (macro, ui_in value[, player]) -- VGA designs on ttsky25a using the TinyVGA
# Pmod pinout. ui_in = 0 leaves buttons released and debug/solid-colour modes
# off, except where a game's buttons are active low.
VGA_DESIGNS = [
    ('tt_um_quarren42_demoscene_top', 0),        # 2 asic design is my passion
    ('tt_um_sleepwell', 0),                      # 130
    ('tt_um_MichaelBell_mandelbrot', 0),         # 266, 100 MHz (RP2040 at 200 MHz)
    ('tt_um_vga_hello_world', 0),                # 427
    ('tt_um_nvious_graphics', 0),                # 682
    ('tt_um_10_vga_crossyroad', 0, play_crossyroad),  # 907
    ('tt_um_tinytapeout_logo_screensaver', 0),   # 965
    ('tt_um_SummerTT_HDL', 0),                   # 192 SJSU Game of Life
    ('tt_um_edwintorok', 0),                     # 256 Rounding error
    ('tt_um_sjsu', 0),                           # 297 SJSU vga demo
    ('tt_um_vga_glyph_mode', 0),                 # 559
    ('tt_um_brandonramos_VGA_Pong_with_NES_Controllers', 0),  # 262 (non-TinyVGA pinout)
    ('tt_um_RoyTr16', C4_IDLE, play_connect_four),  # 260 Tiny Connect Four
    ('tt_um_7FM_ShadyPong', SP_IDLE, play_shady_pong),  # 674
]

DWELL_S = 15
VGA_CLOCK_HZ = 25_175_000


def _entry(macro):
    for e in VGA_DESIGNS:
        if e[0] == macro:
            return e
    return (macro, 0)


def show(tt, macro, ui_in=None):
    print(f"VGA cycle: {macro}")
    if ui_in is None:
        ui_in = _entry(macro)[1]
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
    designs = [e for e in VGA_DESIGNS if tt.shuttle.has(e[0])]
    if not designs:
        print(f"VGA cycle: no known VGA designs on {tt.shuttle.run}")
        return
    print(f"VGA cycle: {len(designs)} designs, {dwell_s}s each. Ctrl-C to stop.")
    try:
        while True:
            for e in designs:
                show(tt, e[0], e[1])
                if len(e) > 2:
                    e[2](tt, dwell_s)
                else:
                    time.sleep(dwell_s)
    except KeyboardInterrupt:
        print("VGA cycle: stopped")
