# SPDX-License-Identifier: Apache-2.0
"""Drive the built app in a real browser against a real board, and take screenshots.

    npm run build && npx vite preview --port 4174 &
    uv run --no-project --with playwright python scripts/board-browser-check.py \
        http://localhost:4174/ wss://tinytapeout.fpgas.online/ws/board/<slug>/serial \
        <sequence.demo.json> <out-dir> [chromium-path]

The page gets a stand-in for navigator.serial whose one port is the board's fpgas.online
serial bridge (a WebSocket), so the app itself, unchanged, connects to the board. Then:
Connect, the board panel and the design list, open the sequence file, run it from RAM,
Stop (which reboots the board), open "Make permanent" and CANCEL it (nothing is written to the board), and
"Reboot board" so the board is left as its own main.py starts it. A screenshot is taken
at each step. Exits non-zero if a step's expected text doesn't appear.
"""
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

url, ws_url, seq_path, out = sys.argv[1], sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4])
chrome = sys.argv[5] if len(sys.argv) > 5 else None
out.mkdir(parents=True, exist_ok=True)

# A SerialPort over the bridge: binary frames are the board's bytes (text frames are the
# bridge's status events and are ignored).
FAKE_SERIAL = """
(() => {
  const WS_URL = %r;
  class BridgePort extends EventTarget {
    async open() {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('bridge refused')); });
      this.ws = ws;
      this.readable = new ReadableStream({
        start(c) {
          ws.onmessage = (m) => { if (typeof m.data !== 'string') c.enqueue(new Uint8Array(m.data)); };
          ws.onclose = () => { try { c.close(); } catch (e) {} };
        },
      });
      this.writable = new WritableStream({ write(chunk) { ws.send(chunk); } });
    }
    async close() { this.ws && this.ws.close(); }
    getInfo() { return { usbVendorId: 0x2e8a, usbProductId: 0x0005 }; }
  }
  const port = new BridgePort();
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port, getPorts: async () => [port] } });
})();
""" % ws_url

failures = 0
step_no = 0


def shot(page, name):
    global step_no
    step_no += 1
    path = out / f'{step_no:02d}-{name}.png'
    page.screenshot(path=str(path), full_page=False)
    print(f'  screenshot {path}', flush=True)


def expect_text(page, text, timeout_s=60):
    global failures
    try:
        page.get_by_text(text).first.wait_for(timeout=timeout_s * 1000)
        print(f'PASS sees "{text}"', flush=True)
        return True
    except Exception as e:  # noqa: BLE001 - report and go on
        failures += 1
        print(f'FAIL no "{text}" within {timeout_s}s: {str(e).splitlines()[0]}', flush=True)
        return False


def button(where, text):
    # by text: SUID's modal hides the page from the accessibility tree, so role queries miss buttons
    return where.locator('button', has_text=re.compile(rf'^\s*{re.escape(text)}\s*$', re.I)).last


def messages(page):
    # the last box of the right-hand column: the heading "Messages" and the log
    return page.locator('section[aria-label="Preview and board"] > div').last.inner_text(timeout=5000)


def wait_idle(page, timeout_s=120):
    # the busy bar is shown while a board job runs
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if page.locator('.MuiLinearProgress-root').count() == 0:
            return
        time.sleep(0.3)
    raise TimeoutError('the app stayed busy')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
    page = browser.new_page(viewport={'width': 1500, 'height': 1000})
    page.on('console', lambda m: print(f'  console.{m.type}: {m.text}'[:300]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print(f'  pageerror: {e}'))
    page.add_init_script(FAKE_SERIAL)
    page.goto(url)

    print('step: connect', flush=True)
    button(page, 'Connect').click()
    expect_text(page, 'connected', 60)
    wait_idle(page)
    board = page.locator('section[aria-label="Preview and board"]')
    expect_text(page, 'FPGA board', 60)
    expect_text(page, 'bitstreams in /bitstreams', 60)
    expect_text(page, 'Designs on FPGA', 60)
    wait_idle(page)
    shot(page, 'connected')

    print('step: open the sequence', flush=True)
    page.locator('input[type=file]').set_input_files(str(seq_path))
    expect_text(page, 'opened', 30)
    wait_idle(page)
    shot(page, 'sequence')

    print('step: run from RAM', flush=True)
    button(page, 'Run this sequence').click()
    expect_text(page, 'running from RAM', 120)
    wait_idle(page)
    time.sleep(12)  # let it switch at least once
    shot(page, 'running')

    print('step: stop (reboots the board back to its normal state)', flush=True)
    button(page, 'Stop').click()
    time.sleep(2)
    expect_text(page, 'the board was rebooted into its normal state', 90)
    wait_idle(page)
    shot(page, 'stopped')

    print('step: make permanent, then cancel', flush=True)
    button(page, 'Make permanent').click()
    dialog = page.locator('.MuiDialog-paper', has_text='Make permanent')
    try:
        dialog.wait_for(timeout=90000)
        expect_text(page, 'On the FPGA board a design is its place', 10)
        shot(page, 'make-permanent-dialog')
        button(dialog, 'Cancel').click()
        dialog.wait_for(state='hidden', timeout=10000)
        print('PASS cancelled: nothing written', flush=True)
    except Exception as e:  # noqa: BLE001 - report, and still reboot the board below
        failures += 1
        print(f'FAIL no confirmation dialog: {str(e).splitlines()[0]}', flush=True)
        shot(page, 'no-dialog')
        print('messages:\n' + messages(page), flush=True)
    time.sleep(1)

    print('step: reboot the board (runs its own main.py)', flush=True)
    button(page, 'Reboot board').click()
    time.sleep(2)
    wait_idle(page, 60)
    shot(page, 'rebooted')
    print('messages:\n' + messages(page), flush=True)
    button(page, 'Disconnect').click()
    time.sleep(1)
    browser.close()

print('ALL PASSED' if not failures else f'{failures} FAILED')
sys.exit(1 if failures else 0)
