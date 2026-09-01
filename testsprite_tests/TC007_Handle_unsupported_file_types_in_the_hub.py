import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:5173")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Upload a plain text file (unsupported.txt) using the hub 'Browse Files' input to trigger file validation.
        # file upload
        elem = page.locator('[id="hub-input"]')
        await elem.wait_for(state="attached", timeout=10000)
        if await elem.evaluate("e => e.tagName === 'INPUT' && (e.type || '').toLowerCase() === 'file'"):
            await elem.set_input_files("./fixtures/unsupported.txt")
        else:
            await elem.wait_for(state="visible", timeout=10000)
            async with page.expect_file_chooser() as fc_info:
                await elem.click()
            chooser = await fc_info.value
            await chooser.set_files("./fixtures/unsupported.txt")
        
        # --> Assertions to verify final state
        
        # --> A file validation error should be visible after uploading the unsupported file.
        # Assert-outcome: failed
        # Assert: Expected the hub drop area to show a file validation error message.
        await expect(page.locator("xpath=/html/body/div[3]/div/div[2]/main/section[1]/div/div[1]").nth(0)).to_contain_text("\u062e\u0637\u0623", timeout=15000), "Expected the hub drop area to show a file validation error message."
        
        # --> No document workspace should be opened after uploading the unsupported file.
        # Assert-outcome: failed
        # Assert: Expected no document workspace or viewer container to be visible on the page.
        await expect(page.locator("xpath=/html/body/div[2]").nth(0)).not_to_be_visible(timeout=15000), "Expected no document workspace or viewer container to be visible on the page."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    