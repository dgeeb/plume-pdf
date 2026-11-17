// Takes the screenshot used in README.md (needs `npm run dev` running and Microsoft Edge).
// Usage: node scripts/readme-shot.mjs
import { chromium } from "playwright-core";
const url = "http://localhost:1420/";
for (let i = 0; i < 40; i++) { try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
await page.goto(url);
const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Open PDF")]);
await fc.setFiles("samples/sample.pdf");
await page.waitForSelector(".page[data-loaded='true'] .textLayer span", { timeout: 15000 });
await page.waitForTimeout(800);

const b = await page.locator(".page[data-page-number='1']").boundingBox();
const k = b.width / 612;
const at = (x, y) => [b.x + x * k, b.y + y * k];

await page.locator("section.textWidgetAnnotation input").first().fill("Jane Doe");
await page.locator("section.buttonWidgetAnnotation.checkBox input").first().check();

await page.keyboard.press("h");
const line = page.locator(".page[data-page-number='1'] .textLayer span", { hasText: "quick brown fox" }).first();
const lb = await line.boundingBox();
await page.mouse.move(lb.x + 2, lb.y + lb.height / 2);
await page.mouse.down();
await page.mouse.move(lb.x + lb.width * 0.6, lb.y + lb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);

await page.keyboard.press("t");
await page.mouse.click(...at(330, 300));
await page.keyboard.type("Looks good!");
await page.keyboard.press("Escape");

await page.locator("button[title^='Stamps']").click();
await page.locator(".menu-item", { hasText: "Check mark" }).click();
await page.mouse.click(...at(300, 245));
await page.keyboard.press("Escape");

await page.keyboard.press("n");
await page.mouse.click(...at(540, 80));
await page.keyboard.type("Remember to sign");
await page.mouse.click(...at(500, 760));
await page.waitForTimeout(500);
await page.screenshot({ path: "docs/screenshot.png" });
await browser.close();
