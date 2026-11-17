// Page-level operations done with pdf-lib on raw bytes.
import { PDFDocument, degrees } from "pdf-lib";

const load = (b: Uint8Array) => PDFDocument.load(b, { updateMetadata: false });

export async function rotatePages(bytes: Uint8Array, indices: number[], cw: boolean): Promise<Uint8Array> {
  const doc = await load(bytes);
  for (const i of indices) {
    const p = doc.getPage(i);
    const cur = p.getRotation().angle;
    p.setRotation(degrees((((cur + (cw ? 90 : -90)) % 360) + 360) % 360));
  }
  return doc.save();
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  [...indices].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return doc.save();
}

/** Reorder pages: `order[newIndex] = oldIndex`. */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  order.forEach((old, i) => doc.insertPage(i, pages[old]));
  return doc.save();
}

/** Append other PDFs at the end. Returns new bytes and number of pages added. */
export async function appendPdfs(bytes: Uint8Array, others: Uint8Array[]): Promise<{ bytes: Uint8Array; added: number }> {
  const doc = await load(bytes);
  let added = 0;
  for (const o of others) {
    const src = await PDFDocument.load(o, { ignoreEncryption: true, updateMetadata: false });
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p) => doc.addPage(p));
    added += pages.length;
  }
  return { bytes: await doc.save(), added };
}

export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export async function mergeFiles(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const b of files) {
    const src = await PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
