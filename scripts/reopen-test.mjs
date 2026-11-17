// Reopen saved PDFs in the app and screenshot them.
import { chromium } from "playwright-core";
const [dir, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:1420/");
for (const f of files) {
  const btn = (await page.locator("text=Open PDF").count()) ? page.locator("text=Open PDF") : page.locator("button[title^='Open PDF']");
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), btn.first().click()]);
  await fc.setFiles(`${dir}/${f}`);
  await page.waitForSelector(".page[data-loaded='true'] .textLayer span", { timeout: 15000 });
  await page.locator("button[title='Zoom']").click();
  await page.locator(".menu-item", { hasText: "Fit page" }).click();
  await page.waitForTimeout(1200);
  const n = await page.locator(".pl-item, .pl-note, .pl-mark, .pl-inkitem").count();
  console.log(f, "editable items:", n, "name field:", await page.locator("section.textWidgetAnnotation input").first().inputValue().catch(() => "(none)"));
  await page.screenshot({ path: `${dir}/reopen-${f}.png` });
}
await browser.close();
