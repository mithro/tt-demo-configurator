"""Run the format fixtures through the pinned firmware demo.py and record its errors.

usage: PYTHONPATH=<firmware>/src:<firmware>/bin uv run --no-project scripts/firmware-errors.py

Writes test/fixtures/bad/<name>.errors.json (the firmware's error list) and fails if a
good fixture has errors. The TypeScript validator's tests compare against these files,
which keeps the app's validator and the board's in line.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src" / "data"))
import demo  # noqa: E402  the pinned copy, as installed on stock boards
from check_demo_sequences import IndexShuttle  # noqa: E402  the release build's index lookup

FIX = ROOT / "test" / "fixtures"
SHUTTLE = "ttsky25a"
shuttle = IndexShuttle(json.loads((FIX / "index.json").read_text()))
bad_good = 0
for path in sorted((FIX / "good").glob("*.json")):
    _entries, errors = demo.load(str(path), SHUTTLE, shuttle)
    if errors:
        print(f"GOOD FIXTURE HAS ERRORS {path.name}: {errors}")
        bad_good += 1
for path in sorted((FIX / "bad").glob("*.json")):
    if path.name.endswith(".errors.json"):
        continue
    _entries, errors = demo.load(str(path), SHUTTLE, shuttle)
    if not errors:
        print(f"BAD FIXTURE HAS NO ERRORS {path.name}")
        bad_good += 1
    out = path.with_name(path.stem + ".errors.json")
    out.write_text(json.dumps(errors, indent=1) + "\n")
    print(f"{path.name}: {len(errors)} error(s)")
sys.exit(1 if bad_good else 0)
