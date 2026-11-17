// Drives the real desktop app via WebView2's debug port and checks the navigation guard.
import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
const [exe, pdf] = process.argv.slice(2);
const app = spawn(exe, [pdf], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9333" }, stdio: "inherit" });
let browser;
for (let i = 0; i < 40 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.connectOverCDP("http://127.0.0.1:9333").catch(() => null);
}
const page = browser.contexts()[0].pages()[0];
await page.waitForSelector(".page[data-page-number='1'] .annotationLayer a", { timeout: 15000 });
const log = (...a) => console.log(...a);
log("app url:", page.url());
// 1. Bypass the frontend: try to navigate the window away directly.
await page.evaluate(() => { location.href = "https://example.com/"; });
await new Promise((r) => setTimeout(r, 1500));
log("after forced navigation:", page.url(), "| doc still open:", await page.locator(".page").count() > 0);
// 2. Try to open a pop-up window.
const r = await page.evaluate(() => String(window.open("https://example.com/", "_blank")));
await new Promise((r) => setTimeout(r, 1000));
log("window.open returned:", r, "| webviews:", browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()));
// 3. Click the web link: a native "Open link" confirmation should appear.
await page.locator(".annotationLayer a").first().click();
await new Promise((r) => setTimeout(r, 1500));
const titles = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${process.argv[4]}"`).toString().trim();
log("windows after link click:", JSON.stringify(titles), "| app url:", page.url());
await browser.close().catch(() => {});
app.kill();
