// Generates samples/sample.pdf: text, a fillable form, and a rotated page.
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { writeFileSync } from "node:fs";

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const p1 = doc.addPage([612, 792]);
p1.drawText("Plume PDF sample document", { x: 60, y: 720, size: 22, font: bold });
const para = [
  "The quick brown fox jumps over the lazy dog. This line is here so you can",
  "highlight, underline or strike through some text and search for words.",
  "Search for the word invoice to test the find bar: invoice number 2026-117.",
];
para.forEach((l, i) => p1.drawText(l, { x: 60, y: 680 - i * 18, size: 12, font }));
p1.drawText("Name:", { x: 60, y: 580, size: 12, font });
p1.drawText("I agree:", { x: 60, y: 545, size: 12, font });
p1.drawText("Signature: ______________________", { x: 60, y: 470, size: 12, font });
const form = doc.getForm();
const name = form.createTextField("name");
name.addToPage(p1, { x: 130, y: 572, width: 220, height: 22 });
const agree = form.createCheckBox("agree");
agree.addToPage(p1, { x: 130, y: 540, width: 16, height: 16 });
const country = form.createDropdown("country");
country.addOptions(["France", "Vietnam", "United States"]);
p1.drawText("Country:", { x: 60, y: 510, size: 12, font });
country.addToPage(p1, { x: 130, y: 503, width: 150, height: 22 });

const p2 = doc.addPage([612, 792]);
p2.drawText("Page 2 - rotated 90 degrees", { x: 60, y: 720, size: 18, font: bold });
p2.drawText("Another invoice mention on a rotated page.", { x: 60, y: 690, size: 12, font });
p2.setRotation(degrees(90));

const p3 = doc.addPage([612, 792]);
p3.drawText("Page 3", { x: 60, y: 720, size: 18, font: bold, color: rgb(0.2, 0.2, 0.6) });
writeFileSync("samples/sample.pdf", await doc.save());
console.log("wrote samples/sample.pdf");
