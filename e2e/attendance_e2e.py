"""End-to-end check for the Attendance module, run against a live server.

Usage:  BASE_URL=http://localhost:4000 python3 e2e/attendance_e2e.py
Requires: pip install playwright && python -m playwright install chromium
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE_URL", "http://localhost:4000")
SHOTS = os.environ.get("SHOTS_DIR", "/home/user/screenshots")
os.makedirs(SHOTS, exist_ok=True)
failures = []


def check(name, fn):
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001
        failures.append(name)
        print(f"FAIL  {name}\n      {str(e)[:400]}")


def login(page, email, password):
    page.goto(f"{BASE}/login")
    page.fill("input[type=email]", email)
    page.fill("input[type=password]", password)
    page.click("button[type=submit]")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- 1. Login page hides demo credentials in a production build -------
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    page = ctx.new_page()
    page.goto(f"{BASE}/login")
    check("login page shows no demo quick-fill buttons", lambda: expect(page.get_by_text("Demo Admin")).to_have_count(0))

    # --- 2. Teacher takes the daily register ------------------------------
    login(page, "teacher@nitex.com", "Teacher@123")
    check("teacher lands on staff console", lambda: page.wait_for_url(f"{BASE}/admin", timeout=10000))
    page.goto(f"{BASE}/admin/attendance")
    check("attendance page opens with register tab", lambda: expect(page.get_by_role("button", name="Take register")).to_be_visible())

    page.locator("select").nth(0).select_option("10")
    page.locator("select").nth(1).select_option("A")
    check("roster table loads for Class 10 A", lambda: expect(page.locator("table tbody tr").first).to_be_visible(timeout=8000))
    rows = page.locator("table tbody tr").count()
    check("roster has at least one student", lambda: (_ for _ in ()).throw(AssertionError("no students")) if rows == 0 else None)

    page.locator('button[title="Present"]').first.click()
    page.locator('button[title="Absent"]').first.click() if rows > 1 else None
    page.get_by_role("button", name="Save register").click()
    check("saving the register shows a success toast", lambda: expect(page.get_by_text("Saved:")).to_be_visible(timeout=8000))
    page.screenshot(path=f"{SHOTS}/1-teacher-register.png", full_page=True)

    # Re-saving the same day must update, not duplicate.
    page.get_by_role("button", name="Save register").click()
    check("re-saving shows updates, not duplicates", lambda: expect(page.get_by_text("0 new")).to_be_visible(timeout=8000))

    # --- 3. Teacher reads the report ------------------------------------
    page.get_by_role("button", name="Reports").click()
    page.locator("select").nth(0).select_option("10")
    check("report shows class average and at-risk card", lambda: expect(page.get_by_text("Class average")).to_be_visible(timeout=8000))
    check("report lists students with a percentage", lambda: expect(page.locator("table tbody").get_by_text("%").first).to_be_visible(timeout=8000))
    page.screenshot(path=f"{SHOTS}/2-teacher-report.png", full_page=True)
    ctx.close()

    # --- 4. Student sees their own attendance -----------------------------
    sctx = browser.new_context(viewport={"width": 1280, "height": 860})
    spage = sctx.new_page()
    login(spage, "student@nitex.com", "Student@123")
    spage.wait_for_url(f"{BASE}/dashboard", timeout=10000)
    spage.goto(f"{BASE}/attendance")
    check("student sees My Attendance page", lambda: expect(spage.get_by_role("heading", name="My Attendance")).to_be_visible(timeout=8000))
    check("student sees overall attendance % from today's register", lambda: expect(spage.get_by_text("Overall (daily register)")).to_be_visible(timeout=8000))
    check("student sees history rows (not the empty state)", lambda: expect(spage.get_by_text("No attendance has been recorded yet.")).to_have_count(0, timeout=8000))
    check("student history table has a row for today", lambda: expect(spage.locator("table tbody tr").first).to_be_visible(timeout=8000))
    spage.screenshot(path=f"{SHOTS}/3-student-attendance.png", full_page=True)

    # --- 5. Students are kept out of staff pages --------------------------
    spage.goto(f"{BASE}/admin/attendance")
    check("student is redirected away from the staff register", lambda: spage.wait_for_url(f"{BASE}/dashboard", timeout=8000))
    sctx.close()
    browser.close()

print("\nRESULT:", "ALL PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
