# SPDX-License-Identifier: Apache-2.0
"""Check the gamepad steps in a real browser: the step editor and the simulated preview.

    npx vite preview --port 4174 &   # after npm run build
    uv run --no-project --with playwright python scripts/gamepad-preview-check.py \
        http://localhost:4174/ <out-dir> [chromium-path]

Opens a ttsky25a sequence of two gamepad designs with no steps, gives each its example
script from the step editor, screenshots the editor, then simulates the Gamepad Pmod Demo
(which lights each button pressed in green) and screenshots the preview as the script
presses its buttons one after another.
"""
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

url = sys.argv[1]
out = Path(sys.argv[2])
chrome = sys.argv[3] if len(sys.argv) > 3 else None
out.mkdir(parents=True, exist_ok=True)

SEQ = {"version": 1, "shuttle": "ttsky25a", "projects": [
    {"address": 967, "subtile": 0, "duration_ms": 30000, "clock_hz": 25175000, "ui_in": 0, "steps": []},
    {"address": 514, "subtile": 0, "duration_ms": 60000, "clock_hz": 25175000, "ui_in": 0, "steps": []}]}
seq_file = out / 'gamepad-start.demo.json'
seq_file.write_text(json.dumps(SEQ))


def caption(preview):
    return ' | '.join(preview.locator('.MuiTypography-caption').all_inner_texts())


def wait_for(cond, what, timeout_s=240, show=None):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        if show:
            text = show()
            if text != last:
                print(f'  [{time.time() - t0:5.1f}s] {text}', flush=True)
                last = text
        if cond():
            return
        time.sleep(0.5)
    raise TimeoutError(f'{what} after {timeout_s}s: {last}')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    page = browser.new_page(viewport={'width': 1400, 'height': 1100})
    page.on('console', lambda m: print(f'  console.{m.type}: {m.text}'[:300]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print(f'  pageerror: {e}'))
    page.add_init_script("localStorage.setItem('tt-demo-configurator.preview-source', 'simulation')")
    page.goto(url)
    page.locator('input[type=file][accept*=json]').set_input_files(str(seq_file))
    editor = page.locator('.MuiCard-root', has=page.get_by_text('Sequence for', exact=True)).first
    editor.get_by_text('Gamepad Pmod Demo').first.wait_for(timeout=60000)

    for title, name in [('2048 sliding tile puzzle game (VGA)', '2048'), ('Gamepad Pmod Demo', 'gamepad-demo')]:
        print(f'== {title}: example script')
        editor.get_by_text(title).first.click()
        button = editor.get_by_role('button', name=re.compile('^Use the example script'))
        button.wait_for()
        print(f'  offered: {button.inner_text()}')
        button.click()
        page.wait_for_timeout(300)
        summary = editor.get_by_text(re.compile(r'steps, [0-9.]+ s per pass')).first.inner_text()
        print(f'  {summary}')
        editor.screenshot(path=str(out / f'editor-{name}.png'))
    errors = page.get_by_text('Problems the board would refuse')
    print(f'  validation errors shown: {errors.count()}')

    # a gamepad step edited by hand: player 2 plugged in, X held
    rows = editor.get_by_role('button', name='+P2')
    print(f'  "+P2" buttons: {rows.count()}')
    rows.first.click()
    editor.locator('button[title^="player 2 X"]').first.click()
    page.wait_for_timeout(300)
    editor.screenshot(path=str(out / 'editor-gamepad-demo-p2.png'))

    preview = page.locator('.MuiCard-root', has=page.get_by_text('Preview', exact=True)).first
    preview.get_by_role('button', name='Play sequence').wait_for()
    print('== simulate the Gamepad Pmod Demo, Play sequence')
    page.locator('div[title^="Gamepad Pmod Demo:"]').click()
    preview.get_by_role('button', name='Play sequence').click()
    wait_for(lambda: re.search(r'simulating · [0-9.]+ fps', caption(preview)), 'not simulating', show=lambda: caption(preview))
    # the demo entry is 30 s of wall-clock time, then 2048 runs for 60 s
    for i in range(170):
        time.sleep(0.5)
        caps = caption(preview)
        if i % 6 == 0:
            preview.screenshot(path=str(out / f'sim-{i // 2:02d}s.png'))
            print(f'  shot sim-{i // 2:02d}s: {caps}')
    preview.get_by_role('button', name='Stop').click()
    browser.close()
