"""Copy each SDK 2.x and 3.x release's stock main.py into src/data/stock-main/.

usage: uv run --no-project scripts/update-stock-main.py <tt-micropython-firmware clone>

Writes one file per distinct main.py (named after the first release that shipped it)
and index.json mapping every release version to its file. The configurator checks a
board's main.py against these exactly before calling it "stock".

SDK 2.x is the RP2040 demoboards' line (2.0.0 to 2.0.4), 3.x the RP2350's. Only final
releases (vX.Y.Z) are taken, not the 2.0.0 betas and release candidates.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

fw = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / "src" / "data" / "stock-main"
out.mkdir(parents=True, exist_ok=True)
tags = subprocess.run(["git", "-C", str(fw), "tag", "-l", "v2.*", "v3.*"], check=True, capture_output=True, text=True).stdout.split()
tags = [t for t in tags if re.fullmatch(r"v\d+\.\d+\.\d+", t)]
tags.sort(key=lambda t: [int(x) for x in t[1:].split(".")])
by_hash, index = {}, {}
for tag in tags:
    text = subprocess.run(["git", "-C", str(fw), "show", f"{tag}:src/main.py"], check=True, capture_output=True).stdout
    h = hashlib.sha256(text).hexdigest()
    if h not in by_hash:
        name = f"main-{tag[1:]}.py"
        (out / name).write_bytes(text)
        by_hash[h] = name
    index[tag[1:]] = by_hash[h]
(out / "index.json").write_text(json.dumps(index, indent=1) + "\n")
print(json.dumps(index, indent=1))
