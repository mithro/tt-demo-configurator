# SPDX-License-Identifier: Apache-2.0
"""Refresh src/data/project-search/ from the Tiny Tapeout project-search database.

usage: uv run --no-project scripts/update-project-search.py [path/to/tt_projects.db]

With no path, the published database is downloaded into tmp/ (the search site serves it as
tt_projects.db.png for GitHub Pages). For each shuttle it writes <shuttle>.json with, per
design macro, the Pmods its pinout matches, its AI-made tags, and its silicon status from
the owners' and users' reports; pmods.json lists the Pmods. The app loads only the file for
the shuttle being looked at.
"""
import json
import pathlib
import sqlite3
import sys
import urllib.request

URL = "https://mith.ro/tinytapeout-project-search/tt_projects.db.png"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "project-search"

if len(sys.argv) > 1:
    db = pathlib.Path(sys.argv[1])
else:
    db = ROOT / "tmp" / "tt_projects.db"
    db.parent.mkdir(exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": "tt-demo-configurator"})
    with urllib.request.urlopen(req, timeout=120) as r:
        db.write_bytes(r.read())
    print(f"downloaded {URL} ({db.stat().st_size} bytes)")

c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
meta = dict(c.execute("select key, value from meta"))
pmods = [
    {"id": i, "name": n, "pins": p, "url": u}
    for i, n, p, u in c.execute("select id, name, pins, url from pmods order by sort_order")
]
OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.json"):
    old.unlink()
(OUT / "pmods.json").write_text(json.dumps(pmods, indent=1) + "\n")

shuttles: dict[str, dict] = {}
rows = c.execute(
    "select shuttle, macro, coalesce(pmods, ''), coalesce(ai_tags, ''), test_status,"
    " fb_working, fb_partial, fb_broken from projects order by shuttle, macro, subtile_addr"
)
for shuttle, macro, pm, tags, status, ok, part, broken in rows:
    projects = shuttles.setdefault(shuttle, {})
    if macro in projects:  # the same macro on two subtiles: the first one's data stands
        continue
    projects[macro] = {
        "pmods": pm.split(),
        "tags": tags.split(),
        "silicon": {"status": status, "working": ok, "partial": part, "broken": broken},
    }
total = 0
for shuttle, projects in shuttles.items():
    doc = {"source": URL, "index_updated": meta.get("index_updated"), "projects": projects}
    (OUT / f"{shuttle}.json").write_text(json.dumps(doc, separators=(",", ":"), sort_keys=True) + "\n")
    total += len(projects)
size = sum(f.stat().st_size for f in OUT.glob("*.json"))
print(f"{OUT.relative_to(ROOT)}: {len(shuttles)} shuttles, {total} designs, {size} bytes, index of {meta.get('index_updated')}")
