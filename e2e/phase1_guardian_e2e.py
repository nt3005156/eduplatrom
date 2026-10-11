"""Phase 1 browser check: admin manages guardians and imports students; a parent sets a
password from a one-time link, signs in on a phone-width screen, and sees only linked children.

Usage (server already running, with an admin account and seeded students):
  BASE_URL=http://localhost:4100 ADMIN_EMAIL=... ADMIN_PASSWORD=... LINKS_FILE=/tmp/p1_links.json \
  python3 e2e/phase1_guardian_e2e.py
LINKS_FILE is a JSON map of email -> setup_url, as returned by the import and guardian APIs.
"""
import json
import os
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:4100")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@e2e.school")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD") or sys.exit("Set ADMIN_PASSWORD to the admin password of the test server")
LINKS = json.load(open(os.environ.get("LINKS_FILE", "/tmp/p1_links.json")))
PARENT_PW = "Ram-Parent-Pass-2026"
SHOTS = os.environ.get("SHOTS_DIR", "/tmp/p1-shots")
os.makedirs(SHOTS, exist_ok=True)
failures = []


def check(name, fn):
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001
        failures.append(name)
        print(f"FAIL  {name}\n      {str(e)[:600]}")


def path_of(url):
    return re.sub(r"^https?://[^/]+", "", url)


with sync_playwright() as p:
    browser = p.chromium.launch()
    console_errors = []

    def watch(page):
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

    # ---------- Admin ----------
    admin_ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    admin = admin_ctx.new_page()
    watch(admin)

    def admin_login():
        admin.goto(f"{BASE}/login")
        admin.fill("input[type=email]", ADMIN_EMAIL)
        admin.fill("input[type=password]", ADMIN_PW)
        admin.click("button[type=submit]")
        admin.wait_for_url(re.compile(r".*/admin.*"), timeout=15000)

    check("admin signs in", admin_login)

    def guardians_list():
        admin.goto(f"{BASE}/admin/guardians")
        expect(admin.get_by_role("cell", name="Ram Sharma")).to_be_visible(timeout=10000)
        row = admin.locator("tr", has_text="Ram Sharma")
        assert "2" in row.inner_text(), "Ram Sharma should show 2 children"
        assert "Setup pending" in row.inner_text(), "new guardian should show Setup pending"
        admin.screenshot(path=f"{SHOTS}/admin-guardians.png", full_page=True)

    check("admin sees the imported guardian with 2 children and Setup pending", guardians_list)

    def import_preview_blocks_bad_rows():
        admin.goto(f"{BASE}/admin/student-import")
        bad = ("name,email,class_level,section,guardian_email,guardian_name\n"
               "Good Kid,good.kid@school.example,6,A,,\n"
               "Bad Kid,not-an-email,13,A,ghost@example.com,Ghost")
        admin.fill("textarea[aria-label='CSV text']", bad)
        admin.get_by_role("button", name=re.compile("Check file")).click()
        expect(admin.get_by_text("need fixing")).to_be_visible(timeout=10000)
        import_btn = admin.get_by_role("button", name=re.compile(r"^\s*Import \d+ student"))
        assert import_btn.count() == 0 or import_btn.is_disabled(), "import must not be allowed while rows are wrong"
        assert admin.get_by_text("class_level must be a whole number from 6 to 12").count() == 1
        admin.screenshot(path=f"{SHOTS}/admin-import-preview.png", full_page=True)

    check("import preview shows bad rows and blocks the import", import_preview_blocks_bad_rows)

    def template_downloads():
        admin.goto(f"{BASE}/admin/student-import")
        with admin.expect_download() as d:
            admin.get_by_role("button", name=re.compile("Download template")).click()
        assert d.value.suggested_filename == "nitex-student-import-template.csv"

    check("the CSV template downloads", template_downloads)

    # ---------- Parent: set password, sign in ----------
    parent_ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    parent = parent_ctx.new_page()
    watch(parent)

    def setup_link_works():
        parent.goto(LINKS["ram.sharma@example.com"])
        expect(parent.get_by_role("heading", name="Set your password")).to_be_visible(timeout=10000)
        # Too short for the 12-character rule: the browser blocks it before any request is sent.
        parent.fill("#pw", "short")
        parent.fill("#pw2", "short")
        parent.get_by_role("button", name="Save password").click()
        parent.wait_for_timeout(300)
        assert parent.get_by_role("heading", name="Set your password").is_visible(), "a short password must not be accepted"
        assert parent.get_by_role("heading", name="Password saved").count() == 0
        parent.fill("#pw", PARENT_PW)
        parent.fill("#pw2", PARENT_PW)
        parent.get_by_role("button", name="Save password").click()
        expect(parent.get_by_role("heading", name="Password saved")).to_be_visible(timeout=10000)

    check("parent sets a password from the setup link", setup_link_works)

    def used_link_refused():
        parent.goto(LINKS["ram.sharma@example.com"])
        expect(parent.get_by_role("heading", name="Link not valid")).to_be_visible(timeout=10000)

    check("the same setup link cannot be used twice", used_link_refused)

    def parent_signs_in_to_portal():
        parent.goto(f"{BASE}/login")
        parent.fill("input[type=email]", "ram.sharma@example.com")
        parent.fill("input[type=password]", PARENT_PW)
        parent.click("button[type=submit]")
        parent.wait_for_url(re.compile(r".*/guardian$"), timeout=15000)
        expect(parent.get_by_text("Your children")).to_be_visible(timeout=10000)
        expect(parent.get_by_text("Asha Sharma")).to_be_visible()
        expect(parent.get_by_text("Bikash Sharma")).to_be_visible()
        body = parent.inner_text("body")
        assert "Sita Rai" not in body, "a child not linked to this parent must not appear"
        assert "Hello, Ram" in body
        parent.screenshot(path=f"{SHOTS}/parent-home-390.png", full_page=True)

    check("parent lands on the portal and sees only linked children", parent_signs_in_to_portal)

    def phone_layout_has_no_overflow():
        width = parent.evaluate("() => document.documentElement.scrollWidth")
        assert width <= 390, f"page is {width}px wide on a 390px phone"

    check("portal fits a 390px phone screen without horizontal scroll", phone_layout_has_no_overflow)

    def no_token_in_storage():
        keys = parent.evaluate("() => Object.keys(localStorage)")
        assert "nitex_token" not in keys
        cookies = {c["name"]: c for c in parent_ctx.cookies()}
        assert cookies.get("nitex_session", {}).get("httpOnly") is True, "session cookie must be HttpOnly"
        assert "nitex_file" not in cookies, "guardians must not get a file cookie"

    check("session is an HttpOnly cookie; no file cookie for the parent", no_token_in_storage)

    def child_attendance_page():
        parent.get_by_role("link", name=re.compile("Open attendance for Asha")).click()
        parent.wait_for_url(re.compile(r".*/guardian/children/\d+$"), timeout=10000)
        expect(parent.get_by_text("Daily attendance")).to_be_visible(timeout=10000)
        parent.screenshot(path=f"{SHOTS}/parent-child-390.png", full_page=True)
        assert parent.evaluate("() => document.documentElement.scrollWidth") <= 390

    check("parent opens a child's attendance on a phone", child_attendance_page)

    def parent_fenced_out():
        result = parent.evaluate("""async () => {
          const out = {};
          for (const u of ['/api/guardians', '/api/announcements', '/api/attendance/summary?class_level=7', '/uploads/x.pdf']) {
            out[u] = (await fetch(u)).status;
          }
          return out;
        }""")
        for u, st in result.items():
            assert st in (401, 403, 404), f"{u} returned {st}"

    check("parent is refused on staff, file and admin routes", parent_fenced_out)

    def parent_cannot_open_admin_pages():
        parent.goto(f"{BASE}/admin/guardians")
        parent.wait_for_url(re.compile(r".*/guardian$"), timeout=10000)

    check("parent who types an admin URL is sent back to the portal", parent_cannot_open_admin_pages)

    # ---------- Parent with no children ----------
    maya_ctx = browser.new_context(viewport={"width": 390, "height": 844})
    maya = maya_ctx.new_page()
    watch(maya)

    def maya_sees_empty_state():
        url = json.load(open(os.environ.get("LINKS2_FILE", "/tmp/p1_links2.json")))["maya.gurung@example.com"]
        maya.goto(url)
        expect(maya.get_by_role("heading", name="Set your password")).to_be_visible(timeout=10000)
        maya.fill("#pw", "Maya-Parent-Pass-2026")
        maya.fill("#pw2", "Maya-Parent-Pass-2026")
        maya.get_by_role("button", name="Save password").click()
        expect(maya.get_by_role("heading", name="Password saved")).to_be_visible(timeout=10000)
        maya.goto(f"{BASE}/login")
        maya.fill("input[type=email]", "maya.gurung@example.com")
        maya.fill("input[type=password]", "Maya-Parent-Pass-2026")
        maya.click("button[type=submit]")
        maya.wait_for_url(re.compile(r".*/guardian$"), timeout=15000)
        expect(maya.get_by_text("No children are linked")).to_be_visible(timeout=10000)

    check("guardian with no children sees a clear message, not an error", maya_sees_empty_state)

    def no_unexpected_console_errors():
        real = [e for e in console_errors if "Content Security Policy" not in e]
        assert not real, f"console errors: {real[:5]}"

    check("no console errors on the pages visited", no_unexpected_console_errors)

    browser.close()

if failures:
    print(f"\n{len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print("\nall Phase 1 browser checks passed")
