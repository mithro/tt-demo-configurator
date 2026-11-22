"""Build the ready-made demo sequences from the Shenzhen (2026-11-11) hand-made boards.

usage: PYTHONPATH=<firmware>/src:<firmware>/bin uv run --no-project scripts/make-shenzhen-demos.py <tt-vga-cycle dir>

Reads each board's vga_cycle.py VGA_DESIGNS list, maps macros to index addresses, and
writes src/data/demos/<shuttle>.demo.json. The three games' random "players" become fixed
step scripts, generated here once from fixed seeds so the files never change on their
own (Tim: the script should always be the same). Every file is checked with the
firmware's own validate() against the live index before it is written.
"""
import ast
import json
import pathlib
import random
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src" / "data"))
import demo  # noqa: E402  the pinned firmware module
from check_demo_sequences import IndexShuttle  # noqa: E402

BOARDS = {"tt-vga-cycle": "ttgf0p3", "tt-vga-cycle-2": "ttsky25b", "tt-vga-cycle-3": "tt09", "tt-vga-cycle-4": "ttsky25a"}
FIELDS = "macro,address,subtile_addr,type,danger_level,clock_hz"
VGA_HZ = 25_175_000
# config.ini on the boards set these clocks; demo.json must say them itself
CLOCK_OVERRIDES = {"tt_um_vga_clock": 31_500_000}
DURATION_MS = 15_000


def crossyroad():
    # ui[0] move_btn, active high: short walks forward with longer pauses
    rng, steps = random.Random(907), []
    for _ in range(12):
        steps += [{"set": 1}, {"wait_ms": rng.randrange(100, 401, 10)},
                  {"set": 0}, {"wait_ms": rng.randrange(300, 1001, 10)}]
    return 0, 20_000, steps


def connect_four():
    # ui[0] drop, ui[1] right, ui[2] left, all active low (idle 0b111). The game freezes on
    # its win screen, so the reset when the steps run out (after 16 drops) starts a new one.
    rng, steps, idle = random.Random(260), [], 0b111

    def press(bit):
        return [{"set": idle & ~(1 << bit)}, {"wait_ms": 40}, {"set": idle}, {"wait_ms": 120}]

    for _ in range(16):
        for _ in range(1 + rng.randrange(4)):
            steps += press(rng.choice((1, 2)))
        steps += press(0) + [{"wait_ms": 250}]
    return idle, 30_000, steps


def shady_pong():
    # ui[0..3] P1 up/down, P2 up/down, active low (idle 0b11111; ui[4] fallback speed)
    rng, steps, idle = random.Random(674), [], 0b11111
    for _ in range(60):
        pressed = (rng.choice((0, 1, 2)) << 0) | (rng.choice((0, 1, 2)) << 2)
        steps += [{"set": idle & ~pressed}, {"wait_ms": rng.randrange(100, 601, 10)}]
    return idle, 20_000, steps


GAMES = {"tt_um_10_vga_crossyroad": crossyroad, "tt_um_RoyTr16": connect_four, "tt_um_7FM_ShadyPong": shady_pong}


def vga_designs(path):
    tree = ast.parse(path.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "VGA_DESIGNS":
            return [(e.elts[0].value, e.elts[1]) for e in node.value.elts]
    raise SystemExit(f"{path}: no VGA_DESIGNS")


def render(shuttle, projects):
    body = ",\n    ".join(json.dumps(p) for p in projects)
    return "{\n" + f'  "version": 1,\n  "shuttle": "{shuttle}",\n  "projects": [\n    {body}\n  ]\n' + "}\n"


def main(src):
    out_dir = ROOT / "src" / "data" / "demos"
    out_dir.mkdir(parents=True, exist_ok=True)
    problems = 0
    for folder, shuttle in BOARDS.items():
        url = f"https://index.tinytapeout.com/{shuttle}.json?fields={FIELDS}"
        req = urllib.request.Request(url, headers={"User-Agent": "tt-demo-configurator"})
        with urllib.request.urlopen(req, timeout=60) as r:
            index = json.load(r)
        by_macro = {p["macro"]: p for p in index["projects"] if p.get("type") != "group"}
        projects = []
        for macro, _ui in vga_designs(pathlib.Path(src) / folder / "vga_cycle.py"):
            p = by_macro[macro]
            clock = CLOCK_OVERRIDES.get(macro) or int(p.get("clock_hz") or 0) or VGA_HZ
            ui_in, duration, steps = GAMES[macro]() if macro in GAMES else (0, DURATION_MS, [])
            projects.append({"address": int(p["address"]), "subtile": int(p.get("subtile_addr", 0)),
                             "duration_ms": duration, "clock_hz": clock, "ui_in": ui_in, "steps": steps})
            print(f"{shuttle} {p['address']:>4} {macro} clock={clock} steps={len(steps)}")
        conf = {"version": 1, "shuttle": shuttle, "projects": projects}
        _entries, errors = demo.validate(conf, shuttle, IndexShuttle(index))
        for e in errors:
            print(f"ERROR {shuttle}: {e}")
        problems += len(errors)
        (out_dir / f"{shuttle}.demo.json").write_text(render(shuttle, projects))
    sys.exit(1 if problems else 0)


main(sys.argv[1])
