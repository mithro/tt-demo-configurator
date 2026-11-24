"""A stand-in for a MicroPython board's raw REPL, for the app's tests.

Reads one JSON request per line on stdin ({"code": ...}), runs the code with exec() in
one persistent namespace (like the board's REPL), and answers {"out": ..., "err": ...}.
Absolute paths are mapped into ROOT (argv[1]) so board files never touch the real "/".
A stub `tt` can be installed with the code itself (tests do that).
"""
import builtins
import contextlib
import importlib
import io
import json
import os
import sys
import traceback

ROOT = os.path.abspath(sys.argv[1])
os.makedirs(ROOT, exist_ok=True)
# the board's working directory is "/": relative paths land in ROOT too, and, as on the
# board, modules in "/" (the helper's /demo.py) can be imported
os.chdir(ROOT)
sys.path.insert(0, ROOT)
_open, _remove, _rename, _stat, _listdir = builtins.open, os.remove, os.rename, os.stat, os.listdir


def _map(p):
    p = os.fspath(p)
    if p == ROOT or p.startswith(ROOT + os.sep):
        return p  # already mapped (CPython's own code makes relative paths absolute)
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
    # CPython caches each sys.path directory's listing and can miss a module file written
    # within the same mtime tick (a flaky "No module named 'demo'"); MicroPython has no cache
    importlib.invalidate_caches()
    with contextlib.redirect_stdout(out):
        try:
            exec(req["code"], ns)
        except BaseException:  # noqa: BLE001 - report everything, like the board
            err.write(traceback.format_exc())
    sys.stdout.write(json.dumps({"out": out.getvalue().replace("\n", "\r\n"), "err": err.getvalue()}) + "\n")
    sys.stdout.flush()
