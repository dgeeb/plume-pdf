// Imperative app actions that combine the store, the viewer and file access.
import { useStore, isDirty } from "./store";
import { viewer } from "./pdf/viewer";
import { extractOwnItems, writeItems } from "./pdf/pdfWrite";
import { rotatePages, deletePages, reorderPages, appendPdfs, extractPages, mergeFiles } from "./pdf/pageOps";
import {
  OpenedFile, pickPdfs, readPath, saveBytes, confirmDialog, alertDialog, addRecent, removeRecent, pickImage,
} from "./lib/platform";
import { imageToDataUrl } from "./lib/image";
import { Item, rotateItem } from "./model";

const st = () => useStore.getState();

async function busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  st().set({ busy: label });
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    await alertDialog(`${label} failed:\n${(e as Error).message ?? e}`);
    return undefined;
  } finally {
    st().set({ busy: null });
  }
}

export function dirty() { return isDirty(st(), viewer.formsModified); }

export async function confirmDiscard(): Promise<boolean> {
  if (!dirty()) return true;
  return confirmDialog("You have unsaved changes. Discard them?");
}

export async function openFiles(files: OpenedFile[], confirmed = false) {
  if (!files.length || (!confirmed && !(await confirmDiscard()))) return;
  await busy("Opening", async () => {
    if (files.length > 1) {
      const bytes = await mergeFiles(files.map((f) => f.bytes));
      const loaded = await extractOwnItems(bytes);
      st().openDoc({ name: "Combined.pdf", path: null, bytes: loaded.bytes, encrypted: false }, loaded.items);
      st().notify(`Combined ${files.length} files. Use Save As to keep the result.`);
      return;
    }
    const f = files[0];
    const loaded = await extractOwnItems(f.bytes);
    st().openDoc({ name: f.name, path: f.path, bytes: loaded.bytes, encrypted: loaded.encrypted }, loaded.items);
    if (f.path) addRecent(f.path);
    if (loaded.encrypted) st().notify("This PDF is protected: you can read and search it, but saving edits is not supported yet.");
  });
}

export async function openDialog(multiple = true) {
  if (!(await confirmDiscard())) return;
  const files = await pickPdfs(multiple);
  await openFiles(files, true);
}

export async function openPath(path: string) {
  if (!(await confirmDiscard())) return;
  try {
    const f = await readPath(path);
    await openFiles([f], true);
  } catch (e) {
    removeRecent(path);
    await alertDialog(`Could not open ${path}\n${(e as Error).message ?? e}`);
  }
}

export async function closeDocument() {
  if (!(await confirmDiscard())) return;
  viewer.close();
  st().closeDoc();
}

/** Bytes of the current document with everything applied. */
export async function exportBytes(flatten: boolean) {
  const s = st();
  if (!s.doc) throw new Error("No document");
  const base = await viewer.bytesWithForms(s.doc.bytes);
  return writeItems(base, s.items, { flatten });
}

export type SaveMode = "save" | "saveAs" | "flatten";

export async function save(mode: SaveMode = "save") {
  const s = st();
  if (!s.doc) return;
  if (s.doc.encrypted) {
    await alertDialog("Saving changes to password-protected PDFs is not supported yet.");
    return;
  }
  const doc = s.doc;
  const flatten = mode === "flatten";
  const name = flatten ? doc.name.replace(/(\.pdf)?$/i, " (flattened).pdf") : doc.name;
  // Snapshot what is being saved before any await, so edits during saving stay "unsaved".
  const itemsAtSave = s.items;
  const bytesAtSave = doc.bytes;
  await busy("Saving", async () => {
    const { bytes, warnings } = await exportBytes(flatten);
    const target = mode === "save" ? doc.path : null;
    const res = await saveBytes(bytes, name, target);
    if (!res) return;
    if (res.path) addRecent(res.path);
    if (!flatten) {
      viewer.markFormsSaved();
      const cur = st();
      if (cur.doc && cur.doc.bytes === bytesAtSave) {
        useStore.setState({
          doc: { ...cur.doc, path: res.path ?? cur.doc.path, name: res.name },
          saved: { bytes: bytesAtSave, items: itemsAtSave },
        });
      }
    }
    st().notify(warnings.length ? warnings.join("\n") : flatten ? `Saved flattened copy: ${res.name}` : `Saved ${res.name}`);
  });
}

// ---------- page operations ----------

async function pageOp(label: string, op: (base: Uint8Array, items: Item[]) => Promise<{ bytes: Uint8Array; items: Item[] }>) {
  const s = st();
  if (!s.doc) return;
  if (s.doc.encrypted) { await alertDialog("Page tools are not available for protected PDFs yet."); return; }
  await busy(label, async () => {
    const base = await viewer.bytesWithForms(s.doc!.bytes);
    const res = await op(base, st().items);
    st().commit(res.items, res.bytes);
  });
}

export function rotate(indices: number[], cw: boolean) {
  return pageOp("Rotating", async (base, items) => {
    const set = new Set(indices);
    const bytes = await rotatePages(base, indices, cw);
    const out = items.map((it) => {
      if (!set.has(it.page)) return it;
      const sz = viewer.pageSizes[it.page];
      return rotateItem(it, sz.w, sz.h, cw);
    });
    return { bytes, items: out };
  });
}

export async function removePages(indices: number[]) {
  const n = viewer.pageSizes.length;
  if (indices.length >= n) { await alertDialog("A PDF needs at least one page."); return; }
  if (!(await confirmDialog(`Delete ${indices.length === 1 ? "page " + (indices[0] + 1) : indices.length + " pages"}?`))) return;
  return pageOp("Deleting pages", async (base, items) => {
    const set = new Set(indices);
    const bytes = await deletePages(base, indices);
    const out = items.filter((it) => !set.has(it.page)).map((it) => ({ ...it, page: it.page - indices.filter((i) => i < it.page).length }));
    return { bytes, items: out };
  });
}

/** order[newIndex] = oldIndex */
export function reorder(order: number[]) {
  return pageOp("Reordering", async (base, items) => {
    const bytes = await reorderPages(base, order);
    const newIndexOf = new Map(order.map((old, i) => [old, i]));
    return { bytes, items: items.map((it) => ({ ...it, page: newIndexOf.get(it.page) ?? it.page })) };
  });
}

export async function insertPdfs() {
  if (!st().doc) return;
  const files = await pickPdfs(true);
  if (!files.length) return;
  await pageOp("Inserting", async (base, items) => {
    const { bytes, added } = await appendPdfs(base, files.map((f) => f.bytes));
    st().notify(`Added ${added} page${added === 1 ? "" : "s"} at the end.`);
    return { bytes, items };
  });
}

export async function extract(indices: number[]) {
  const s = st();
  if (!s.doc || !indices.length) return;
  await busy("Extracting", async () => {
    const { bytes } = await exportBytes(false);
    const out = await extractPages(bytes, [...indices].sort((a, b) => a - b));
    const label = indices.length === 1 ? `page ${indices[0] + 1}` : `${indices.length} pages`;
    const res = await saveBytes(out, s.doc!.name.replace(/(\.pdf)?$/i, ` (${label}).pdf`), null);
    if (res) st().notify(`Extracted ${label} to ${res.name}`);
  });
}

// ---------- images ----------

export async function chooseImageForPlacement() {
  const f = await pickImage();
  if (!f) return;
  const img = await busy("Loading image", () => imageToDataUrl(f.bytes));
  if (!img) return;
  // Default to ~ 1/3 page width, in points.
  const w = Math.min(200, img.w * 0.75);
  st().set({ placement: { src: img.src, w, h: (w * img.h) / img.w }, tool: "place", selectedId: null });
}
