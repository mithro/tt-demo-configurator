"""A stand-in for a MicroPython board's raw REPL, for the app's tests.

Reads one JSON request per line on stdin ({"code": ...}), runs the code with exec() in
one persistent namespace (like the board's REPL), and answers {"out": ..., "err": ...}.
Absolute paths are mapped into ROOT (argv[1]) so board files never touch the real "/".
A stub `tt` can be installed with the code itself (tests do that).
"""
import builtins
import contextlib
import io
import json
import os
import sys
import traceback

ROOT = os.path.abspath(sys.argv[1])
os.makedirs(ROOT, exist_ok=True)
_open, _remove, _rename, _stat, _listdir = builtins.open, os.remove, os.rename, os.stat, os.listdir


def _map(p):
    p = os.fspath(p)
    return os.path.join(ROOT, p.lstrip("/")) if p.startswith("/") else os.path.join(ROOT, p)


builtins.open = lambda p, *a, **k: _open(_map(p), *a, **k)
os.remove = lambda p: _remove(_map(p))
os.rename = lambda a, b: _rename(_map(a), _map(b))
os.stat = lambda p: _stat(_map(p))
os.listdir = lambda p="/": _listdir(_map(p))

ns = {"__name__": "__main__"}
for line in sys.stdin:
    req = json.loads(line)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out):
        try:
            exec(req["code"], ns)
        except BaseException:  # noqa: BLE001 - report everything, like the board
            err.write(traceback.format_exc())
    sys.stdout.write(json.dumps({"out": out.getvalue().replace("\n", "\r\n"), "err": err.getvalue()}) + "\n")
    sys.stdout.flush()
