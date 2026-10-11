"""Phase 5 i18n browser check: the sign-in page, the setup page, and the parent portal in English and Nepali.

It fails if any screen shows a raw translation key (for example "login.title"), if the page language
or font does not follow the choice, or if an uncaught page error occurs. It also checks that a language
saved on the account overrides the device choice after a fresh load.

Usage (server running, with a parent account that has a password set):
  BASE_URL=http://localhost:4100 GUARDIAN_EMAIL=ram.sharma@example.com GUARDIAN_PASSWORD=... \\
  SHOTS_DIR=/tmp/p5-shots python3 e2e/phase5_i18n_e2e.py
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:4100")
EMAIL = os.environ.get("GUARDIAN_EMAIL", "ram.sharma@example.com")
PASSWORD = os.environ.get("GUARDIAN_PASSWORD") or sys.exit("Set GUARDIAN_PASSWORD to the parent account password")
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/p5-shots")
os.makedirs(SHOTS, exist_ok=True)

# Namespaces used by the translation files. A match in visible text means a key was rendered raw.
RAW_KEY = re.compile(
    r"\b(?:auth|common|guardian|login|reapply|setup|home|fees|attendance|profile|layout|actions|theme|language|footer|app)"
    r"\.[a-zA-Z][A-Za-z_]*\b"
)
failures = []


def check(name, cond, detail=""):
    if cond:
        print(f"PASS  {name}")
    else:
        failures.append(name)
        print(f"FAIL  {name}\n      {detail[:400]}")


def no_raw_keys(page, name):
    text = page.inner_text("body")
    found = RAW_KEY.findall(text)
    check(f"{name}: no raw translation keys", not found, f"found {found[:6]}")


def html_lang(page):
    return page.evaluate("document.documentElement.lang")


def stored_lang(page):
    return page.evaluate("localStorage.getItem('nitex_lang')")


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    # 1. Sign-in page, English by default.
    page.goto(f"{BASE}/login")
    expect(page.get_by_role("heading", name="Welcome back")).to_be_visible()
    check("login: English heading on first visit", html_lang(page) == "en")
    no_raw_keys(page, "login (en)")
    page.screenshot(path=f"{SHOTS}/login-en.png")

    # 2. Switch to Nepali on the sign-in page.
    page.get_by_role("button", name="नेपाली", exact=True).click()
    expect(page.get_by_role("heading", name="फेरि स्वागत छ")).to_be_visible()
    check("login: html lang is ne after switch", html_lang(page) == "ne", html_lang(page))
    check("login: choice stored on device", stored_lang(page) == "ne", str(stored_lang(page)))
    body_font = page.evaluate("getComputedStyle(document.body).fontFamily")
    check("login: Nepali body uses Noto Sans Devanagari", "Noto Sans Devanagari" in body_font, body_font)
    no_raw_keys(page, "login (ne)")
    page.screenshot(path=f"{SHOTS}/login-ne.png")

    # 3. Setup page with no token shows the Nepali message, then English after switching.
    page.goto(f"{BASE}/setup")
    expect(page.get_by_text("यो पृष्ठका लागि विद्यालयबाट पठाइएको सेटअप लिंक चाहिन्छ।")).to_be_visible()
    no_raw_keys(page, "setup without token (ne)")
    page.get_by_role("button", name="English", exact=True).click()
    expect(page.get_by_text("This page needs a setup link from your school.")).to_be_visible()
    check("setup: switches to English in place", html_lang(page) == "en")
    no_raw_keys(page, "setup without token (en)")
    page.get_by_role("button", name="नेपाली", exact=True).click()
    expect(page.get_by_text("यो पृष्ठका लागि विद्यालयबाट पठाइएको सेटअप लिंक चाहिन्छ।")).to_be_visible()

    # 4. Parent signs in while the device is set to Nepali. The account has no saved language yet,
    #    so the device choice (Nepali) should carry into the portal.
    page.goto(f"{BASE}/login")
    expect(page.get_by_role("heading", name="फेरि स्वागत छ")).to_be_visible()
    page.fill('input[type="email"]', EMAIL)
    page.fill('input[type="password"]', PASSWORD)
    page.get_by_role("button", name="साइन इन").click()
    expect(page).to_have_url(re.compile(r".*/guardian$"), timeout=15000)
    expect(page.get_by_role("heading", name="तपाईंका बच्चाहरू")).to_be_visible()
    check("portal: Nepali after sign-in with device choice", html_lang(page) == "ne")
    no_raw_keys(page, "guardian home (ne)")
    page.screenshot(path=f"{SHOTS}/guardian-home-ne.png")

    # 5. Switch to English from the portal. The choice is saved to the account.
    with page.expect_response(lambda r: "/auth/me/language" in r.url) as resp:
        page.get_by_role("button", name="English", exact=True).click()
    check("portal: switch saves to account (HTTP 200)", resp.value.status == 200, str(resp.value.status))
    expect(page.get_by_role("heading", name="Your children")).to_be_visible()
    no_raw_keys(page, "guardian home (en)")

    # 6. Account language overrides the device. Clear the device choice and reload.
    page.evaluate("localStorage.removeItem('nitex_lang')")
    page.reload()
    expect(page.get_by_role("heading", name="Your children")).to_be_visible()
    check("portal: saved English applies after reload with no device choice", html_lang(page) == "en")

    # 7. Attendance screen and profile in English, then Nepali.
    page.get_by_role("link", name="Attendance").first.click()
    expect(page).to_have_url(re.compile(r".*/guardian/children/\d+$"))
    expect(page.get_by_text("Day by day")).to_be_visible()
    no_raw_keys(page, "child attendance (en)")
    page.get_by_role("link", name="Back").click()
    expect(page).to_have_url(re.compile(r".*/guardian$"))
    page.get_by_role("link", name="My profile").click()
    expect(page.get_by_text("Sign-in email")).to_be_visible()
    no_raw_keys(page, "guardian profile (en)")

    page.get_by_role("button", name="नेपाली", exact=True).click()
    expect(page.get_by_text("लगइन इमेल")).to_be_visible()
    check("profile: Nepali heading after switch", html_lang(page) == "ne")
    no_raw_keys(page, "guardian profile (ne)")
    page.screenshot(path=f"{SHOTS}/guardian-profile-ne.png")

    # 8. Restore the account language to unset so the parent account is left as it was found.
    status = context.request.put(
        f"{BASE}/api/auth/me/language",
        data=json.dumps({"language": None}),
        headers={"Content-Type": "application/json", "X-NITEX-Client": "web"},
    ).status
    check("cleanup: account language reset to unset", status == 200, str(status))

    check("no uncaught page errors", not page_errors, " | ".join(page_errors))
    browser.close()

print()
if failures:
    print(f"{len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print("all i18n browser checks passed")
