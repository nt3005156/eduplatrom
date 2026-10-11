"""Browser check for Phase 0 silent session renewal, run against a live production-mode server.

Usage:
  BASE_URL=http://localhost:4100 ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 e2e/refresh_e2e.py
Requires: pip install playwright && python -m playwright install chromium

Checks: login sets a 15-minute access cookie and an HttpOnly refresh cookie; when only the access cookie
is gone, the app renews silently and stays signed in; when both are gone, the app returns to sign-in.
"""
import os
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:4100")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@e2e.school")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin-E2E-Pass-2026")
results = []


def check(name, ok):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context()
    page = ctx.new_page()
    refresh_calls = []
    page.on("response", lambda r: refresh_calls.append((r.url, r.status)) if "/api/auth/refresh" in r.url else None)

    page.goto(BASE + "/login")
    page.fill("input[type=email]", EMAIL)
    page.fill("input[type=password]", PASSWORD)
    page.keyboard.press("Enter")
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)

    names = {c["name"]: c for c in ctx.cookies()}
    life = names.get("nitex_session", {}).get("expires", 0) - time.time()
    check("login sets the access cookie with a lifetime of at most 15 minutes", 0 < life <= 905)
    check("login sets the refresh cookie as HttpOnly", "nitex_refresh" in names and names["nitex_refresh"]["httpOnly"])

    # Simulate expiry: remove only the access cookie, keep the refresh cookie.
    ctx.clear_cookies(name="nitex_session")
    page.goto(BASE + "/admin")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    check("with the access cookie gone, the app renews and stays signed in", "/login" not in page.url)
    check("a refresh call was made and succeeded", any(s == 200 for _, s in refresh_calls))
    check("a new access cookie is in place", any(c["name"] == "nitex_session" for c in ctx.cookies()))

    # Both cookies gone: the user must sign in again.
    ctx.clear_cookies()
    page.goto(BASE + "/admin")
    page.wait_for_url(lambda u: "/login" in u, timeout=15000)
    check("with both cookies gone, the app returns to sign-in", "/login" in page.url)
    browser.close()

print(f"{sum(results)} of {len(results)} checks passed")
