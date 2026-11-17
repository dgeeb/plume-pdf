import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const logs = [];
page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));
page.on("console", (m) => { if (m.type() === "error") logs.push("[console] " + m.text()); });
page.on("dialog", (d) => { logs.push("[dialog] " + d.message()); d.accept(); });
await page.goto("http://localhost:1420/");
const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Open PDF")]);
await fc.setFiles("samples/sample.pdf");
await page.waitForSelector(".page[data-loaded='true'] .textLayer span");
await page.locator("button[title='Zoom']").click();
await page.locator(".menu-item", { hasText: "Fit page" }).click();
await page.waitForTimeout(800);
const geo = async (n) => { const b = await page.locator(`.page[data-page-number='${n}']`).boundingBox(); return b; };
let b = await geo(1);
let k = b.width / 612;
const at = (x, y) => [b.x + x * k, b.y + y * k];
const count = () => page.locator(".pl-item, .pl-note, .pl-mark, .pl-inkitem").count();

// text tool via toolbar
await page.locator("button[title='Add text (T)']").click();
await page.mouse.click(...at(330, 250));
await page.keyboard.type("Line one\nSecond line");
await page.mouse.click(...at(500, 700)); // click elsewhere ends editing
logs.push("after text: " + await count());

// highlight via tool then select
await page.keyboard.press("h");
const sp = page.locator(".page[data-page-number='1'] .textLayer span", { hasText: "Search for the word" }).first();
const s = await sp.boundingBox();
await page.mouse.move(s.x + 1, s.y + s.height / 2); await page.mouse.down();
await page.mouse.move(s.x + s.width - 2, s.y + s.height / 2, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
logs.push("after highlight: " + await count());
// strike
await page.keyboard.press("k");
const sp2 = page.locator(".page[data-page-number='1'] .textLayer span", { hasText: "highlight, underline" }).first();
const s2 = await sp2.boundingBox();
await page.mouse.move(s2.x + 1, s2.y + s2.height / 2); await page.mouse.down();
await page.mouse.move(s2.x + s2.width * 0.4, s2.y + s2.height / 2, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
logs.push("after strike: " + await count());

// pen
await page.keyboard.press("p");
await page.mouse.move(...at(380, 400)); await page.mouse.down();
for (let i = 0; i <= 25; i++) await page.mouse.move(...at(380 + i * 6, 400 + Math.sin(i / 3) * 15));
await page.mouse.up();
logs.push("after pen: " + await count());
await page.keyboard.press("Escape");

// drag the text box
const tb = page.locator(".pl-text").first();
const tbb = await tb.boundingBox();
await page.mouse.move(tbb.x + 10, tbb.y + 5); await page.mouse.down();
await page.mouse.move(tbb.x + 60, tbb.y + 45, { steps: 6 }); await page.mouse.up();
const tbb2 = await tb.boundingBox();
logs.push(`drag moved: ${Math.round(tbb2.x - tbb.x)},${Math.round(tbb2.y - tbb.y)}`);
// resize via handle -> font grows
const h = await page.locator(".pl-handle").boundingBox();
await page.mouse.move(h.x + 5, h.y + 5); await page.mouse.down();
await page.mouse.move(h.x + 40, h.y + 25, { steps: 5 }); await page.mouse.up();
const tbb3 = await tb.boundingBox();
logs.push(`resize: ${Math.round(tbb2.width)}x${Math.round(tbb2.height)} -> ${Math.round(tbb3.width)}x${Math.round(tbb3.height)}`);
// change color via props bar
await page.locator(".propsbar .swatch[title='#d32f2f']").click();
await page.screenshot({ path: `${out}/01-edits.png` });

// edit text by double click
await page.mouse.dblclick(tbb3.x + 15, tbb3.y + 10);
await page.keyboard.press("End"); await page.keyboard.type("!");
await page.keyboard.press("Escape");
logs.push("text now: " + JSON.stringify(await page.locator(".pl-text").first().textContent()));

// delete key on selected, then undo
await page.locator(".pl-text").first().click();
await page.keyboard.press("Delete");
const afterDel = await count();
await page.keyboard.press("Control+z");
logs.push(`delete/undo: ${afterDel} -> ${await count()}`);

// Note on rotated page 2: navigate, place text there
await page.locator(".thumb[data-thumb='1']").click();
await page.waitForTimeout(800);
b = await geo(2); k = b.width / 792;
await page.keyboard.press("t");
await page.mouse.click(...at(100, 100));
await page.keyboard.type("Upright on rotated page");
await page.keyboard.press("Escape");
await page.screenshot({ path: `${out}/02-rotated-page.png` });
// rotate page 2 right with item on it
await page.locator("button[title^='Rotate page 2 right']").click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-page2-rotated-again.png` });

// Save and check
const [dl] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+s")]);
await dl.saveAs(`${out}/saved.pdf`);
logs.push("title: " + await page.title());
console.log(logs.join("\n"));
await browser.close();
