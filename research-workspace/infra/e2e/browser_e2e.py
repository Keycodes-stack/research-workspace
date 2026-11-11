"""Drives the real UI (Next.js -> Go gateway -> FastAPI -> Postgres) with Playwright.
usage: browser_e2e.py TOKEN_FILE PDF_FILE OUT_DIR"""
import sys
import time
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

token = Path(sys.argv[1]).read_text().strip()
pdf, out = sys.argv[2], Path(sys.argv[3])
out.mkdir(exist_ok=True, parents=True)
BASE = "http://localhost:3000"
errors = []
NAME = f"Injection stability {int(time.time())}"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1100, "height": 900})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.get_by_label("Access token").fill(token)
    page.get_by_role("button", name="Continue").click()
    page.get_by_label("Name").fill(NAME)
    page.get_by_role("button", name="Create project").click()
    page.get_by_role("link", name=NAME).click()

    page.set_input_files("input[type=file]", pdf)
    expect(page.get_by_text("liquid")).to_be_visible()
    expect(page.get_by_text("Full text")).to_be_visible()
    page.get_by_placeholder("New task title").fill("Storage limits")
    page.get_by_role("button", name="Create task").click()

    page.wait_for_url("**/tasks/**")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Save selection").click()
    page.get_by_role("button", name="Approve and lock sources").click()
    expect(page.get_by_text("Approved and locked")).to_be_visible()
    page.screenshot(path=str(out / "1_task_approved.png"))
    page.get_by_role("button", name="New session").click()
    page.wait_for_url("**/threads/**")

    def ask(q):
        page.get_by_label("Your question").fill(q)
        page.get_by_role("button", name="Ask", exact=True).click()

    # 1. consensus
    ask("How stable is the liquid injection?")
    expect(page.get_by_role("heading", name="Verified answer")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Confirmed by both")).to_be_visible()
    page.locator("details.cite summary").first.click()
    expect(page.locator("mark").first).to_have_text("stable at 4 C\nfor twelve weeks")
    page.screenshot(path=str(out / "2_consensus.png"), full_page=True)

    # 2. a fabricated claim is purged
    ask("How stable is the liquid injection? fabricate")
    expect(page.get_by_text("1 model claim removed (failed verification)")).to_be_visible(timeout=20000)
    assert page.get_by_text("52 weeks").count() == 0, "fabricated claim leaked into the UI"

    # 3. disagreement
    ask("conflict: how long is the liquid injection stable?")
    expect(page.get_by_role("heading", name="Models disagree")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Storage duration")).to_be_visible()
    page.screenshot(path=str(out / "3_disagreement.png"), full_page=True)

    # 4. similarity gate
    ask("quarterly revenue forecast for retail banks")
    expect(page.get_by_text("The models were not asked")).to_be_visible(timeout=20000)
    page.screenshot(path=str(out / "4_gate.png"), full_page=True)

    # Business Case PDF export through the real gateway
    page.get_by_role("button", name="Export PDF").click()
    page.get_by_label("Report title (optional)").fill("Injection stability: business case")
    page.get_by_label("Prepared by (optional)").fill("J. Akbar")
    page.get_by_label("Include a financial projection").check()
    page.get_by_label("Upfront cost").fill("50,000")
    page.get_by_label("Annual benefit (year 1)").fill("32000")
    page.get_by_label("Annual running cost").fill("4000")
    page.get_by_label("Discount rate (%)").fill("8")
    page.get_by_label("Horizon (years, 1–20)").fill("5")
    page.screenshot(path=str(out / "6_export_panel.png"))
    with page.expect_download(timeout=30000) as dl:
        page.get_by_role("button", name="Download PDF").click()
    dl.value.save_as(str(out / "business_case.pdf"))
    expect(page.get_by_text("Downloaded Injection_stability_business_case_business_case.pdf")).to_be_visible()

    # invalid financial input is caught in the form, not sent
    page.get_by_label("Discount rate (%)").fill("500")
    page.get_by_role("button", name="Download PDF").click()
    expect(page.get_by_role("alert").filter(has_text="Discount rate must be between 0 and 100")).to_be_visible()
    page.get_by_label("Discount rate (%)").fill("8")

    # history reloads from the server with citations intact
    page.reload()
    expect(page.get_by_role("heading", name="Models disagree")).to_be_visible(timeout=20000)
    assert page.locator("section.answer").count() == 4, page.locator("section.answer").count()
    page.locator("details.cite summary").first.click()
    assert page.locator("details.cite mark").count() >= 1

    # mobile width: no horizontal scroll
    page.set_viewport_size({"width": 390, "height": 800})
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "horizontal overflow"
    page.screenshot(path=str(out / "5_mobile.png"), full_page=True)
    b.close()

print("console errors:", errors)
print("E2E OK")
