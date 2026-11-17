// Round-trip test of the PDF writer: write every item type, read back, flatten.
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFArray, PDFDict } from "pdf-lib";
import { writeItems, extractOwnItems, makeMapper } from "../src/pdf/pdfWrite";
import { rotatePages, deletePages, reorderPages, appendPdfs, extractPages } from "../src/pdf/pageOps";
import type { Item } from "../src/model";

const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const bytes = new Uint8Array(readFileSync("samples/sample.pdf"));
const items: Item[] = [
  { id: "t1", page: 0, rot: 0, type: "text", text: "Hello – café ✓ €", font: "Helvetica", bold: false, fontSize: 14, color: "#1a3c8f", x: 300, y: 100, w: 120, h: 21 },
  { id: "r1", page: 0, rot: 0, type: "rect", fill: "#ffffff", x: 60, y: 100, w: 100, h: 20 },
  { id: "i1", page: 0, rot: 0, type: "image", src: png1x1, signature: true, x: 150, y: 300, w: 120, h: 40 },
  { id: "s1", page: 0, rot: 0, type: "shape", shape: "check", color: "#000000", x: 130, y: 236, w: 14, h: 14 },
  { id: "k1", page: 0, rot: 0, type: "ink", color: "#d32f2f", width: 2, paths: [[{ x: 100, y: 400 }, { x: 150, y: 420 }, { x: 200, y: 400 }]] },
  { id: "h1", page: 0, rot: 0, type: "highlight", color: "#fff176", rects: [{ x: 60, y: 98, w: 300, h: 14 }] },
  { id: "u1", page: 0, rot: 0, type: "underline", color: "#e53935", rects: [{ x: 60, y: 116, w: 200, h: 14 }] },
  { id: "n1", page: 0, rot: 0, type: "note", color: "#ffd54f", x: 500, y: 60, text: "Check this ✔" },
  { id: "t2", page: 1, rot: 0, type: "text", text: "On rotated page", font: "Times", bold: true, fontSize: 12, color: "#000000", x: 50, y: 50, w: 100, h: 18 },
];

// mapping sanity: rotated page 2 (612x792 rotated 90 -> display 792x612)
const d = await PDFDocument.load(bytes);
const m = makeMapper(d.getPage(1));
ok(JSON.stringify(m(0, 0)) === JSON.stringify([0, 0]) && JSON.stringify(m(792, 0)) === JSON.stringify([0, 792]), "rot90 mapper corners");

const { bytes: out, warnings } = await writeItems(bytes, items, { flatten: false });
writeFileSync("samples/out-annotated.pdf", out);
ok(warnings.length === 0, "no warnings");
const doc = await PDFDocument.load(out);
const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
const subtypes = annots.asArray().map((r) => (doc.context.lookup(r) as PDFDict).get(PDFName.of("Subtype"))?.toString());
console.log("  page1 annots:", subtypes.join(" "));
ok(["/FreeText", "/Square", "/Stamp", "/Ink", "/Highlight", "/Underline", "/Text"].every((s) => subtypes.includes(s)), "all annotation subtypes written");

const back = await extractOwnItems(out);
ok(back.items.length === items.length, `round-trip item count ${back.items.length}/${items.length}`);
ok(JSON.stringify(back.items.find((i) => i.id === "t1")) === JSON.stringify(items[0]), "text item identical after round-trip");
const cleaned = await PDFDocument.load(back.bytes);
const left = cleaned.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
ok(left.size() === 3, `only form widgets left on page 1 (${left.size()})`);
ok(back.bytes.length < out.length, `cleaned file smaller (${back.bytes.length} < ${out.length})`);

// Re-save after reopening should not grow
const { bytes: out2 } = await writeItems(back.bytes, back.items, { flatten: false });
ok(Math.abs(out2.length - out.length) < 2000, `re-save stable size (${out.length} -> ${out2.length})`);

const { bytes: flat, warnings: fw } = await writeItems(bytes, items, { flatten: true });
writeFileSync("samples/out-flat.pdf", flat);
ok(fw.length === 0, "flatten without warnings " + fw.join(";"));
const fdoc = await PDFDocument.load(flat);
const fAnn = fdoc.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray);
ok(fdoc.getForm().getFields().length === 0, "form fields flattened");
ok((fAnn?.size() ?? 0) === 1, `only the sticky note remains as annotation (${fAnn?.size()})`);

// page ops
const rot = await rotatePages(bytes, [0], true);
ok((await PDFDocument.load(rot)).getPage(0).getRotation().angle === 90, "rotate page");
const del = await deletePages(bytes, [1]);
ok((await PDFDocument.load(del)).getPageCount() === 2, "delete page");
const ro = await reorderPages(bytes, [2, 0, 1]);
const rod = await PDFDocument.load(ro);
ok(rod.getPageCount() === 3 && rod.getPage(1).getRotation().angle === 0 && rod.getPage(2).getRotation().angle === 90, "reorder pages");
ok((await PDFDocument.load(ro)).getForm().getFields().length === 3, "form survives reorder");
const ap = await appendPdfs(bytes, [bytes]);
ok(ap.added === 3 && (await PDFDocument.load(ap.bytes)).getPageCount() === 6, "append pdf");
const ex = await extractPages(out, [0]);
const exd = await PDFDocument.load(ex);
ok(exd.getPageCount() === 1 && (exd.getPage(0).node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.size() ?? 0) >= 8, "extract keeps annotations");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
