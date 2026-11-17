import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFArray, PDFDict } from "pdf-lib";
const doc = await PDFDocument.load(readFileSync(process.argv[2]));
doc.getPages().forEach((p, i) => {
  const a = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  console.log("page", i + 1, a?.asArray().map((r) => { const d = doc.context.lookup(r) as PDFDict; return `${r} ${d?.get(PDFName.of("Subtype"))} ${d?.get(PDFName.of("T")) ?? ""}`; }));
});
