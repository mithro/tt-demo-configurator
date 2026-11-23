# SPDX-License-Identifier: Apache-2.0
"""Fetch the real Tiny Tapeout SDK 2.x source (the RP2040 demoboards' firmware) into
tmp/sdk2/, for src/lib/sdk2.real.test.ts, which runs the app's board-side code against
it in the CPython fake board. Without tmp/sdk2/ that test is skipped.

usage: uv run --no-project scripts/fetch-sdk2.py [tag]     (default v2.0.4)

Leaves tmp/sdk2/fw (the firmware at the tag) and tmp/sdk2/microcotb (its submodule at
the commit the tag pins).
"""
import pathlib
import shutil
import subprocess
import sys

TAG = sys.argv[1] if len(sys.argv) > 1 else "v2.0.4"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "tmp" / "sdk2"
FW = OUT / "fw"
MCOTB = OUT / "microcotb"


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True)
git("clone", "--quiet", "--depth", "1", "--branch", TAG, "https://github.com/TinyTapeout/tt-micropython-firmware.git", str(FW))
# "160000 commit <sha>\tmicrocotb"
sha = git("ls-tree", "HEAD", "microcotb", cwd=FW).split()[2]
MCOTB.mkdir()
git("init", "--quiet", cwd=MCOTB)
git("fetch", "--quiet", "--depth", "1", "https://github.com/psychogenic/microcotb.git", sha, cwd=MCOTB)
git("checkout", "--quiet", "FETCH_HEAD", cwd=MCOTB)
(OUT / "TAG").write_text(TAG.lstrip("v") + "\n")
print(f"SDK {TAG} in {FW}, microcotb {sha[:10]} in {MCOTB}")
