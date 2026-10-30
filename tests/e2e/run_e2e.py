"""End-to-end checks in headless Chromium against the local dev server.

    npm run test:e2e        # or: python3 tests/e2e/run_e2e.py

Starts scripts/dev.mjs on a free port, then drives the real page. The happy
paths read the live Cardano preprod ledger; failure paths replace
/api/ledger with canned answers. Needs Playwright for Python and Node.
Set E2E_LIVE=0 to mock every ledger call (for offline runs).
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FIRST = ROOT / "sample_exam.pdf"
MOCK = ROOT / "samples/physics-midsem-2026.pdf"
TAMPERED = ROOT / "samples/physics-midsem-2026-tampered.pdf"
TX = "2359d5ee55cd58ff614cc364c35dbc42d29df79a67d278323c40091247ae752b"
FP = "ee47d1dab3dd41ada1687923306bd864523bf1ac53269fb681e183e6ddc3c581"
ADDR = json.loads((ROOT / "registry.json").read_text())["issuers"]["team-pragmatic"]["address"]
LIVE = os.environ.get("E2E_LIVE", "1") != "0"

results = []


def check(name, fn):
    try:
        fn()
        results.append((True, name, ""))
    except Exception as e:  # noqa: BLE001
        msg = (str(e) or type(e).__name__).splitlines()[0][:200]
        results.append((False, name, msg))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def canned(fingerprint=FP, exam="Physics Mid-Sem 2026", inputs=None, found=True):
    seal = {"tx": TX, "found": found}
    if found:
        seal.update(blockHeight=4926909, blockTime=1783839614, confirmations=12,
                    inputAddresses=inputs if inputs is not None else [ADDR],
                    metadata={"fingerprint": fingerprint, "exam": exam})
    return json.dumps({"network": "preprod", "tip": {"blockHeight": 4926920, "blockTime": 1}, "seals": [seal]})


def main():
    port = free_port()
    env = {**os.environ, "PORT": str(port), "NODE_USE_ENV_PROXY": "1"}
    server = subprocess.Popen(["node", "scripts/dev.mjs"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://localhost:{port}"
    for _ in range(50):
        try:
            urllib.request.urlopen(base, timeout=1)
            break
        except Exception:  # noqa: BLE001
            time.sleep(0.1)

    launch = {}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        u = urlparse(proxy)
        launch["proxy"] = {"server": f"{u.scheme}://{u.hostname}:{u.port}", "bypass": "localhost,127.0.0.1"}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**launch)

            def page(width=1440, height=900, mock=None, **ctx):
                context = browser.new_context(viewport={"width": width, "height": height}, accept_downloads=True, **ctx)
                pg = context.new_page()
                pg.errors = []
                pg.on("pageerror", lambda e: pg.errors.append(str(e)))
                pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" else None)
                body = mock if mock is not None else (None if LIVE else canned())
                if body is not None:
                    pg.route("**/api/ledger*", lambda r: r.fulfill(status=200, content_type="application/json", body=body))
                pg.goto(base + "/", wait_until="networkidle")
                pg.wait_for_selector("#register-body .status", timeout=20000)
                return pg

            def drop(pg, path, selector="#file"):
                pg.set_input_files(selector, str(path))

            def verdict(pg, cls):
                pg.wait_for_selector(f".label.{cls}", timeout=20000)

            # 1. Load: ledger read live, no console errors, no CSP violations.
            def t_load():
                pg = page()
                status = pg.inner_text("#register-body .status")
                assert status == "Read from the ledger and matches", status
                assert "Latest block" in pg.inner_text("#ledger-tip")
                assert not pg.errors, pg.errors
                pg.close()
            check("page loads and reads the seal from the ledger", t_load)

            # 2. The sealed file passes in "any paper" mode.
            def t_intact():
                pg = page()
                drop(pg, FIRST)
                verdict(pg, "is-intact")
                assert "64 of 64" in pg.inner_text("#sheet-sub")
                assert pg.locator(".omr-bubble.is-filled").count() == 64
                assert pg.locator(".omr-bubble.is-key").count() == 0
                assert FP in pg.inner_text(".receipt")
                pg.close()
            if FIRST.exists():
                check("sealed file shows Seal intact", t_intact)

            # 3. An unsealed file is "no seal", not "tampered".
            def t_noseal():
                pg = page()
                pg.click("[data-sample=original]")
                verdict(pg, "is-none")
                assert "not been written to the ledger" in pg.inner_text("#result")
                pg.close()
            check("unsealed mock paper shows No seal on file", t_noseal)

            # 4. Named comparison shows exactly where the copy differs.
            def t_broken():
                pg = page()
                pg.select_option("#claim", "physics-midsem-2026-hackathon")
                drop(pg, TAMPERED)
                verdict(pg, "is-broken")
                wrong = pg.locator(".omr-row.is-wrong").count()
                keys = pg.locator(".omr-bubble.is-key").count()
                assert wrong == keys and wrong > 40, (wrong, keys)
                assert f"{64 - wrong} of 64" in pg.inner_text("#sheet-sub")
                # Switching back to "any" re-decides without re-hashing.
                pg.select_option("#claim", "")
                verdict(pg, "is-none")
                assert pg.locator(".omr-bubble.is-key").count() == 0
                pg.close()
            check("named comparison shows Seal broken and the red-pen diff", t_broken)

            # 5. Empty file.
            def t_empty():
                pg = page()
                pg.set_input_files("#file", files=[{"name": "empty.pdf", "mimeType": "application/pdf", "buffer": b""}])
                pg.wait_for_selector(".label.is-problem")
                assert "empty" in pg.inner_text("#result")
                pg.close()
            check("empty file is refused with a reason", t_empty)

            # 6. Ledger down, then back: nothing is decided until it answers.
            def t_down():
                pg = page(mock="")  # placeholder, replaced below
                pg.unroute("**/api/ledger*")
                pg.route("**/api/ledger*", lambda r: r.fulfill(status=502, content_type="application/json", body='{"error":"ledger_unreachable","message":"Could not read the Cardano ledger right now."}'))
                pg.reload(wait_until="networkidle")
                pg.wait_for_selector("#register-body .status.is-wait")
                assert "Try again" in pg.inner_text("#ledger-tip")
                drop(pg, FIRST if FIRST.exists() else MOCK)
                if FIRST.exists():
                    verdict(pg, "is-unknown")
                    pg.unroute("**/api/ledger*")
                    pg.route("**/api/ledger*", lambda r: r.fulfill(status=200, content_type="application/json", body=canned()))
                    pg.click(".label.is-unknown .btn")
                    verdict(pg, "is-intact")
                pg.close()
            check("ledger outage gives Ledger unreachable, retry recovers", t_down)

            # 7. Registry and ledger disagree.
            def t_mismatch():
                pg = page(mock=canned(fingerprint="0" * 64))
                assert pg.inner_text("#register-body .status") == "Registry and ledger disagree"
                if FIRST.exists():
                    drop(pg, FIRST)
                    verdict(pg, "is-problem")
                pg.close()
            check("ledger fingerprint different from registry is a Record problem", t_mismatch)

            # 8. Same fingerprint, signed by someone else.
            def t_issuer():
                pg = page(mock=canned(inputs=["addr_test1qimposter"]))
                assert pg.inner_text("#register-body .status") == "Signed by a different wallet"
                pg.close()
            check("seal from an unknown wallet is rejected", t_issuer)

            # 9. Hostile metadata is shown as text.
            def t_xss():
                pg = page(mock=canned(exam='<img src=x onerror="window.pwned=1">'))
                assert pg.locator("#register-body img").count() == 0
                assert "<img" in pg.inner_text("#register-body").lower()
                assert not pg.evaluate("window.pwned === 1")
                pg.close()
            check("exam name from the ledger cannot inject markup", t_xss)

            # 10. A newer file wins a race with an older one.
            def t_race():
                pg = page()
                pg.select_option("#claim", "physics-midsem-2026-hackathon")
                drop(pg, MOCK)
                drop(pg, TAMPERED)
                verdict(pg, "is-broken")
                pg.wait_for_timeout(600)
                assert "tampered" in pg.inner_text(".receipt"), pg.inner_text(".receipt")
                pg.close()
            check("rapid second file replaces the first", t_race)

            # 11. Seal a paper: byte limit, shell quoting, download.
            def t_seal():
                pg = page()
                drop(pg, MOCK, "#seal-file")
                pg.fill("#seal-name", "x" * 65)
                assert "Too long" in pg.inner_text("#seal-name-help")
                assert pg.locator("#seal-out pre").count() == 0
                pg.fill("#seal-name", "Victor's Physics $HOME")
                pg.wait_for_selector("#seal-out pre.code")
                cmd = pg.locator("#seal-out pre.code").nth(1).inner_text()
                assert "--exam 'Victor'\\''s Physics $HOME'" in cmd, cmd
                with pg.expect_download() as d:
                    pg.click("text=Download record.json")
                rec = json.loads(Path(d.value.path()).read_text())
                assert rec["exam_name"] == "Victor's Physics $HOME" and len(rec["fingerprint"]) == 64
                pg.close()
            check("seal form limits bytes, quotes the command and downloads the record", t_seal)

            # 12. Layout at four widths, reduced motion, keyboard.
            def t_layout():
                for w in (320, 390, 768, 1440):
                    pg = page(width=w, height=900, reduced_motion="reduce")
                    sw = pg.evaluate("document.documentElement.scrollWidth")
                    assert sw <= w, f"{w}px: page is {sw}px wide"
                    lines = pg.evaluate("(() => { const h = document.querySelector('h1'); return Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)); })()")
                    assert lines <= 2, f"{w}px: h1 runs to {lines} lines"
                    pg.click("[data-sample=tampered]")
                    pg.wait_for_selector(".verdict")
                    assert pg.evaluate("document.documentElement.scrollWidth") <= w
                    pg.close()
                pg = page()
                pg.keyboard.press("Tab")
                pg.keyboard.press("Tab")
                for _ in range(8):
                    if pg.evaluate("document.activeElement && document.activeElement.id") == "file":
                        break
                    pg.keyboard.press("Tab")
                assert pg.evaluate("document.activeElement.id") == "file", "file input is not reachable by keyboard"
                pg.close()
            check("no horizontal scroll at 320 to 1440, h1 within two lines, keyboard reaches the picker", t_layout)

            # 13. Only the site is served.
            def t_private():
                for path in ("/push_to_chain.js", "/package.json", "/.env", "/sample_exam.pdf", "/assets/..%2f..%2fpackage.json"):
                    try:
                        code = urllib.request.urlopen(base + path).status
                    except urllib.error.HTTPError as e:
                        code = e.code
                    assert code in (400, 404), f"{path} returned {code}"
            check("repo files outside the site are not served", t_private)

            browser.close()
    finally:
        server.terminate()

    width = max(len(n) for _, n, _ in results)
    for ok, name, err in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {err}")
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f"\n{len(results) - failed} passed, {failed} failed ({'live ledger' if LIVE else 'mocked ledger'})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
