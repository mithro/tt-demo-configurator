"""Refresh src/data/videos.json from the Tiny Tapeout VGA videos index.

usage: uv run --no-project scripts/update-videos.py

The videos site sends no CORS headers, so the app can't read its index.json from
GitHub Pages; a trimmed copy is bundled instead. (The clips themselves load fine in
<video> and <img> across origins.)
"""
import json
import pathlib
import urllib.request

BASE = "https://data.wafer.space/big-storage/tinytapeout-vga-videos/"
OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "data" / "videos.json"
with urllib.request.urlopen(BASE + "index.json", timeout=60) as r:
    index = json.load(r)
out = {"base": BASE, "generated": index["generated"], "shuttles": {}}
for p in index["projects"]:
    v = p.get("video") or {}
    rec = {"pmods": p.get("pmods") or [], "verdict": p.get("verdict")}
    if p.get("has_video") and v.get("stem"):
        rec |= {"dir": v["dir"], "stem": v["stem"], "lengths": sorted(
            int(n[len(v["stem"]) + 1:-5]) for n in v.get("files", {}) if n.endswith("s.mp4"))}
    out["shuttles"].setdefault(p["shuttle"], {})[p["macro"]] = rec
OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True) + "\n")
n = sum(len(s) for s in out["shuttles"].values())
print(f"{OUT.name}: {n} projects, {OUT.stat().st_size} bytes, generated {index['generated']}")
