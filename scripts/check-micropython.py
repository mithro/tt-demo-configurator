"""Compile the Python the app sends to boards with MicroPython's mpy-cross.

usage: uv run --no-project --with mpy-cross scripts/check-micropython.py

CPython runs these files in the tests; this catches syntax MicroPython lacks.
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = [ROOT / "src/lib/py/detect.py", ROOT / "src/data/demo.py", ROOT / "src/data/demo-sdk2.py"]
out_dir = ROOT / "tmp" / "mpy"
out_dir.mkdir(parents=True, exist_ok=True)
bad = 0
for f in FILES:
    r = subprocess.run(["mpy-cross", "-o", str(out_dir / (f.stem + ".mpy")), str(f)], capture_output=True, text=True)
    print(f"{f.relative_to(ROOT)}: {'ok' if r.returncode == 0 else 'FAILED'} {r.stdout}{r.stderr}".strip())
    bad += r.returncode != 0
shutil.rmtree(out_dir)
sys.exit(1 if bad else 0)
