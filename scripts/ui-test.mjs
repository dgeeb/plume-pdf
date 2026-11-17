// Drives the app in Microsoft Edge (browser mode) and takes screenshots.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "shots";
mkdirSync(out, { recursive: true });
const url = "http://localhost:1420/";
for (let i = 0; i < 40; i++) { try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("dialog", (d) => { logs.push(`[dialog] ${d.message()}`); d.accept(); });
await page.goto(url);
await page.screenshot({ path: `${out}/01-welcome.png` });

const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Open PDF")]);
await fc.setFiles("samples/sample.pdf");
await page.waitForSelector(".page[data-loaded='true'] .textLayer span", { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/02-opened.png` });

const pageBox = async (n) => (await page.locator(`.page[data-page-number='${n}']`).boundingBox());
let b = await pageBox(1);
const k = b.width / 612; // css px per pt
const at = (x, y) => [b.x + x * k, b.y + y * k];

// Fill form field
await page.locator("section.textWidgetAnnotation input").first().fill("Jane Doe");
await page.locator("section.buttonWidgetAnnotation.checkBox input").first().check();

// Text tool
await page.keyboard.press("t");
await page.mouse.click(...at(330, 216));
await page.keyboard.type("Hello from Plume");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Highlight: select the first paragraph line via mouse drag on text layer
await page.keyboard.press("h");
const line = page.locator(".page[data-page-number='1'] .textLayer span", { hasText: "quick brown fox" }).first();
const lb = await line.boundingBox();
await page.mouse.move(lb.x + 2, lb.y + lb.height / 2);
await page.mouse.down();
await page.mouse.move(lb.x + lb.width * 0.6, lb.y + lb.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);

// Underline the second line
await page.keyboard.press("u");
const line2 = page.locator(".page[data-page-number='1'] .textLayer span", { hasText: "highlight, underline" }).first();
const l2 = await line2.boundingBox();
await page.mouse.move(l2.x + 2, l2.y + l2.height / 2);
await page.mouse.down();
await page.mouse.move(l2.x + l2.width * 0.5, l2.y + l2.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);

// Pen
await page.keyboard.press("p");
await page.mouse.move(...at(380, 450));
await page.mouse.down();
for (let i = 0; i <= 20; i++) await page.mouse.move(...at(380 + i * 6, 450 + Math.sin(i / 3) * 15));
await page.mouse.up();

// White-out over "Signature: ____"
await page.keyboard.press("w");
await page.mouse.move(...at(58, 308));
await page.mouse.down();
await page.mouse.move(...at(180, 326), { steps: 5 });
await page.mouse.up();

// Check stamp
await page.locator("button[title^='Stamps']").click();
await page.locator(".menu-item", { hasText: "Check mark" }).click();
await page.mouse.click(...at(300, 245));
await page.keyboard.press("Escape");

// Sticky note
await page.keyboard.press("n");
await page.mouse.click(...at(540, 80));
await page.keyboard.type("Remember to sign");
await page.mouse.click(...at(500, 760));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/03-edited.png` });

// Signature: draw
await page.keyboard.press("s");
await page.waitForSelector(".sig-pad");
const pad = await page.locator(".sig-pad").boundingBox();
await page.mouse.move(pad.x + 60, pad.y + 120);
await page.mouse.down();
for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 60 + i * 12, pad.y + 120 - Math.sin(i / 2.5) * 40);
await page.mouse.up();
await page.screenshot({ path: `${out}/04-signature-dialog.png` });
await page.click("text=Place on page");
await page.mouse.move(...at(250, 315));
await page.mouse.click(...at(250, 315));
await page.waitForTimeout(300);

// Find
await page.keyboard.press("Control+f");
await page.keyboard.type("invoice");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/05-find.png` });
const count = await page.locator(".find-count").textContent();
logs.push("find count: " + count);
await page.keyboard.press("Escape");

// Save -> download
const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+s")]);
await dl.saveAs(`${out}/saved.pdf`);
logs.push("saved " + dl.suggestedFilename());
const [dl2] = await Promise.all([page.waitForEvent("download"), (async () => {
  await page.locator("button[title='Save']").click();
  await page.locator(".menu-item", { hasText: "flattened" }).click();
})()]);
await dl2.saveAs(`${out}/flattened.pdf`);

// Undo / redo
const before = await page.locator(".pl-item, .pl-note, .pl-mark, .pl-inkitem").count();
await page.keyboard.press("Control+z");
const afterUndo = await page.locator(".pl-item, .pl-note, .pl-mark, .pl-inkitem").count();
await page.keyboard.press("Control+y");
const afterRedo = await page.locator(".pl-item, .pl-note, .pl-mark, .pl-inkitem").count();
logs.push(`items before/undo/redo: ${before}/${afterUndo}/${afterRedo}`);

// Page tools: rotate page 3, then zoom
await page.locator(".thumb[data-thumb='2']").click();
await page.locator("button[title^='Rotate page 3 right']").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/06-rotated.png` });

// dark mode
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.locator(".thumb[data-thumb='0']").click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/07-dark.png` });

console.log(logs.join("\n"));
await browser.close();
