// Test PDF with a web link, a mailto link, a javascript: link and an internal link to page 2.
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const p1 = doc.addPage([612, 792]);
const p2 = doc.addPage([612, 792]);
p2.drawText("Page two", { x: 72, y: 700, size: 24, font });
const ctx = doc.context;
const links: [string, number, Record<string, unknown>][] = [
  ["Web link: example.com", 700, { S: "URI", URI: PDFString.of("https://example.com/hello?x=1") }],
  ["Mail link", 650, { S: "URI", URI: PDFString.of("mailto:someone@example.com") }],
  ["Script link (must be refused)", 600, { S: "URI", URI: PDFString.of("javascript:alert(1)") }],
];
const annots = links.map(([label, y, action]) => {
  p1.drawText(label, { x: 72, y, size: 18, font, color: rgb(0, 0, 0.8) });
  return ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [70, y - 4, 400, y + 20], Border: [0, 0, 0], A: action }));
});
p1.drawText("Go to page 2", { x: 72, y: 550, size: 18, font, color: rgb(0, 0.5, 0) });
annots.push(ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [70, 546, 400, 570], Border: [0, 0, 0], Dest: [p2.ref, PDFName.of("XYZ"), null, null, null] })));
p1.node.set(PDFName.of("Annots"), ctx.obj(annots));
writeFileSync(process.argv[2], await doc.save());
