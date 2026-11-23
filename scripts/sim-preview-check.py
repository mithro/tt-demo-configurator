# SPDX-License-Identifier: Apache-2.0
"""Check the simulated preview in a real browser and take screenshots.

    npx vite preview --port 4174 &   # after npm run build
    uv run --no-project --with playwright python scripts/sim-preview-check.py \
        http://localhost:4174/ <out-dir> [chromium-path]

Loads the ready-made ttsky25a sequence with the preview set to Simulation, then for the
Tiny Tapeout logo screensaver (965) and Crossyroad (907, whose steps press move_btn) plays
the sequence from that entry and screenshots the preview while it simulates.
"""
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

url = sys.argv[1]
out = Path(sys.argv[2])
chrome = sys.argv[3] if len(sys.argv) > 3 else None
out.mkdir(parents=True, exist_ok=True)


def caption(preview):
    return preview.locator('.MuiTypography-caption').all_inner_texts()


def wait_running(page, preview, timeout_s=180):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        caps = caption(preview)
        text = ' | '.join(caps)
        if text != last:
            print(f'  [{time.time() - t0:5.1f}s] {text}', flush=True)
            last = text
        if re.search(r'simulating · [0-9.]+ fps', text):
            return text
        if "Couldn't simulate" in text:
            raise RuntimeError(text)
        time.sleep(0.5)
    raise TimeoutError(f'not running after {timeout_s}s: {last}')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    page = browser.new_page(viewport={'width': 1400, 'height': 1000})
    page.on('console', lambda m: print(f'  console.{m.type}: {m.text}'[:300]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print(f'  pageerror: {e}'))
    page.add_init_script("localStorage.setItem('tt-demo-configurator.preview-source', 'simulation')")
    page.goto(url)
    page.get_by_role('button', name=re.compile(r'^ttsky25a')).first.click()
    preview = page.locator('.MuiCard-root', has=page.get_by_text('Preview', exact=True)).first
    preview.get_by_text('Play sequence').wait_for()

    def segment(title):
        seg = page.locator(f'div[title^="{title}:"]')
        seg.wait_for(timeout=60000)
        return seg

    # 1. a simple design, run on its own (sequence stopped, click the picture)
    title = 'VGA Screensaver with Tiny Tapeout Logo'
    print(f'== {title}, sequence stopped, click to run')
    segment(title).click()
    t0 = time.time()
    while 'not playing' not in ' '.join(caption(preview)):
        if time.time() - t0 > 180:
            raise TimeoutError(' | '.join(caption(preview)))
        time.sleep(0.5)
    print(f'  ready (first frame, held) after {time.time() - t0:.1f}s: {" | ".join(caption(preview))}')
    preview.screenshot(path=str(out / 'screensaver-held.png'))
    preview.locator('canvas').click()
    wait_running(page, preview)
    for i in range(3):
        time.sleep(4)
        print(f"  t+{4 * (i + 1)}s: {' | '.join(caption(preview))}")
    preview.screenshot(path=str(out / 'screensaver.png'))
    preview.locator('canvas').click()
    time.sleep(1)
    print(f"  clicked again: {' | '.join(caption(preview))}")

    # 2. a game with steps, followed by the sequence timeline
    title = 'Crossyroad'
    print(f'== {title}, Play sequence from its entry')
    segment(title).click()
    preview.get_by_role('button', name='Play sequence').click()
    wait_running(page, preview)
    seen = set()
    for i in range(30):
        time.sleep(0.5)
        caps = ' | '.join(caption(preview))
        m = re.search(r'ui_in (0x[0-9a-f]{2})', caps)
        if m:
            seen.add(m.group(1))
        if i in (4, 24):
            preview.screenshot(path=str(out / f'crossyroad-{i // 2:02d}s.png'))
            print(f'  shot crossyroad-{i // 2:02d}s: {caps}')
    print(f'  ui_in values seen: {sorted(seen)}')
    preview.get_by_role('button', name='Pause').click()
    time.sleep(1.5)
    caps = ' | '.join(caption(preview))
    print(f'  paused: {caps}')
    preview.screenshot(path=str(out / 'crossyroad-paused.png'))
    time.sleep(2)
    print(f"  still paused 2 s later: {' | '.join(caption(preview)) == caps}")
    preview.get_by_role('button', name='Resume').click()
    wait_running(page, preview)
    # let the timeline move on to the next entry (Crossyroad is 20 s long)
    t0 = time.time()
    body = preview.inner_text()
    while 'Crossyroad —' in body and time.time() - t0 < 40:
        time.sleep(1)
        body = preview.inner_text()
    line = [ln for ln in body.splitlines() if ' — ' in ln]
    print(f'  timeline moved on to: {line}')
    wait_running(page, preview)
    preview.screenshot(path=str(out / 'next-entry.png'))
    preview.get_by_role('button', name='Stop').click()

    # 3. a design the engine can't model: the failure, with the way back to the recording
    for title, name in [('Tiny Connect Four', 'failure'), ('ShadyPong', 'shadypong')]:
        print(f'== {title}, sequence stopped')
        segment(title).click()
        t0 = time.time()
        while time.time() - t0 < 180:
            caps = ' | '.join(caption(preview))
            if "Couldn't simulate" in caps or 'not playing' in caps:
                break
            time.sleep(0.5)
        print(f'  after {time.time() - t0:.1f}s: {caps}')
        preview.screenshot(path=str(out / f'{name}.png'))

    # the toggle back to Recording
    preview.get_by_role('button', name='Recording').click()
    time.sleep(1)
    print(f"== recording: video present: {preview.locator('video').count()}")
    preview.screenshot(path=str(out / 'recording-toggle.png'))
    browser.close()
