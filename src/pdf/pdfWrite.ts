// Writing app items into a PDF (as real annotations, or flattened into page content),
// and reading them back so they stay editable when the file is reopened.
import {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFStream,
  PDFFont, PDFPage, StandardFonts, PDFObject,
} from "pdf-lib";
import {
  Item, Rect, Rot, TextItem, InkItem, MarkupItem, NoteItem, ShapeItem,
  naturalSize, itemBounds, isBoxLike, hexToRgb, NOTE_SIZE, TEXT_PAD, LINE_HEIGHT, FontFamily,
} from "../model";

const DATA_KEY = "PlumeData";
const NM_PREFIX = "plume-";

type Mat = [number, number, number, number, number, number];
type Mapper = (dx: number, dy: number) => [number, number];

// ---------- coordinate mapping (display space -> PDF user space) ----------

export function pageView(page: PDFPage): { x0: number; y0: number; x1: number; y1: number; rot: Rot } {
  const m = page.getMediaBox();
  let b = m;
  try { b = page.getCropBox(); } catch { /* ignore */ }
  const x0 = Math.max(Math.min(b.x, b.x + b.width), Math.min(m.x, m.x + m.width));
  const y0 = Math.max(Math.min(b.y, b.y + b.height), Math.min(m.y, m.y + m.height));
  const x1 = Math.min(Math.max(b.x, b.x + b.width), Math.max(m.x, m.x + m.width));
  const y1 = Math.min(Math.max(b.y, b.y + b.height), Math.max(m.y, m.y + m.height));
  const okBox = x1 > x0 && y1 > y0;
  const v = okBox ? { x0, y0, x1, y1 } : { x0: m.x, y0: m.y, x1: m.x + m.width, y1: m.y + m.height };
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return { ...v, rot: (Math.round(r / 90) * 90) % 360 as Rot };
}

/** Same mapping PDF.js uses for a viewport at scale 1. */
export function makeMapper(page: PDFPage): Mapper {
  const { x0, y0, x1, y1, rot } = pageView(page);
  switch (rot) {
    case 90: return (dx, dy) => [x0 + dy, y0 + dx];
    case 180: return (dx, dy) => [x1 - dx, y0 + dy];
    case 270: return (dx, dy) => [x1 - dy, y1 - dx];
    default: return (dx, dy) => [x0 + dx, y1 - dy];
  }
}

/** local (natural box, y-up, origin bottom-left) -> display */
function localToDisplayFn(box: Rect, rot: Rot, nw: number, nh: number) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const cos = Math.round(Math.cos((rot * Math.PI) / 180));
  const sin = Math.round(Math.sin((rot * Math.PI) / 180));
  return (lx: number, ly: number): [number, number] => {
    const u = lx - nw / 2, v = nh - ly - nh / 2;
    return [cx + u * cos - v * sin, cy + u * sin + v * cos];
  };
}

function matrixFor(box: Rect, rot: Rot, nw: number, nh: number, map: Mapper): Mat {
  const l2d = localToDisplayFn(box, rot, nw, nh);
  const p0 = map(...l2d(0, 0)), p1 = map(...l2d(1, 0)), p2 = map(...l2d(0, 1));
  return [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];
}

function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const f = (n: number) => (Math.abs(n) < 1e-6 ? "0" : (+n.toFixed(3)).toString());
const rgb = (hex: string) => hexToRgb(hex).map(f).join(" ");

// ---------- fonts ----------

const STD: Record<FontFamily, [StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};
/** Baseline offset from the top of a CSS line box (line-height 1.2), as a fraction of font size. */
export const BASELINE: Record<FontFamily, number> = { Helvetica: 0.9465, Times: 0.9375, Courier: 0.866 };

class FontCache {
  private cache = new Map<string, PDFFont>();
  constructor(private doc: PDFDocument) {}
  async get(family: FontFamily, bold: boolean) {
    const key = family + (bold ? "B" : "");
    let font = this.cache.get(key);
    if (!font) {
      font = await this.doc.embedFont(STD[family][bold ? 1 : 0]);
      this.cache.set(key, font);
    }
    return font;
  }
}

function encodeSafe(font: PDFFont, text: string): string {
  try {
    return font.encodeText(text).toString();
  } catch {
    const safe = [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
    return font.encodeText(safe).toString();
  }
}

// ---------- appearance builders ----------

interface Appearance {
  ops: string;
  resources: Record<string, unknown>;
  nw: number;
  nh: number;
  box: Rect;
  rot: Rot;
}

async function textAppearance(it: TextItem, fonts: FontCache): Promise<Appearance> {
  const { nw, nh } = naturalSize(it);
  const font = await fonts.get(it.font, it.bold);
  const size = it.fontSize, lh = size * LINE_HEIGHT;
  let ops = `${rgb(it.color)} rg\n`;
  it.text.split("\n").forEach((line, i) => {
    if (!line) return;
    const y = nh - TEXT_PAD - i * lh - BASELINE[it.font] * size;
    ops += `BT /F0 ${f(size)} Tf 1 0 0 1 ${f(TEXT_PAD)} ${f(y)} Tm ${encodeSafe(font, line)} Tj ET\n`;
  });
  return { ops, resources: { Font: { F0: font.ref } }, nw, nh, box: it, rot: it.rot };
}

function circlePath(cx: number, cy: number, r: number) {
  const k = 0.5523 * r;
  return `${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ` +
    `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ` +
    `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ` +
    `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c `;
}

/** Shape geometry in natural box, y-down unit coords; shared with the on-screen SVG. */
export const SHAPE_PATHS: Record<"check" | "cross", [number, number][][]> = {
  check: [[[0.12, 0.55], [0.4, 0.82], [0.9, 0.16]]],
  cross: [[[0.18, 0.18], [0.82, 0.82]], [[0.82, 0.18], [0.18, 0.82]]],
};
export const shapeStroke = (nw: number, nh: number) => Math.max(1, Math.min(nw, nh) * 0.13);

function shapeAppearance(it: ShapeItem): Appearance {
  const { nw, nh } = naturalSize(it);
  const sw = shapeStroke(nw, nh);
  let ops = "";
  if (it.shape === "dot") {
    ops = `${rgb(it.color)} rg ${circlePath(nw / 2, nh / 2, Math.min(nw, nh) / 2)}f\n`;
  } else if (it.shape === "circle") {
    ops = `${rgb(it.color)} RG ${f(sw * 0.6)} w ${circlePath(nw / 2, nh / 2, Math.min(nw, nh) / 2 - sw * 0.3)}S\n`;
  } else {
    ops = `${rgb(it.color)} RG ${f(sw)} w 1 J 1 j\n`;
    for (const poly of SHAPE_PATHS[it.shape]) {
      ops += poly.map(([x, y], i) => `${f(x * nw)} ${f((1 - y) * nh)} ${i ? "l" : "m"}`).join(" ") + " S\n";
    }
  }
  return { ops, resources: {}, nw, nh, box: it, rot: it.rot };
}

function displayAppearance(bounds: Rect, ops: (toLocal: (x: number, y: number) => string) => string, resources = {}): Appearance {
  const b = { ...bounds, w: Math.max(bounds.w, 1), h: Math.max(bounds.h, 1) };
  const toLocal = (x: number, y: number) => `${f(x - b.x)} ${f(b.y + b.h - y)}`;
  return { ops: ops(toLocal), resources, nw: b.w, nh: b.h, box: b, rot: 0 };
}

function inkAppearance(it: InkItem): Appearance {
  return displayAppearance(itemBounds(it), (L) => {
    let s = `${rgb(it.color)} RG ${f(it.width)} w 1 J 1 j\n`;
    for (const p of it.paths) {
      if (!p.length) continue;
      s += `${L(p[0].x, p[0].y)} m `;
      if (p.length === 1) s += `${L(p[0].x + 0.01, p[0].y)} l `;
      for (let i = 1; i < p.length; i++) s += `${L(p[i].x, p[i].y)} l `;
      s += "S\n";
    }
    return s;
  });
}

/** Thin bars for underline/strike, in display space, following text orientation. */
export function markupBars(it: MarkupItem): Rect[] {
  if (it.type === "highlight") return it.rects;
  const under = it.type === "underline";
  return it.rects.map((r) => {
    const vertical = it.rot === 90 || it.rot === 270;
    const thick = Math.max(0.8, (vertical ? r.w : r.h) * 0.07);
    if (!vertical) {
      const off = under ? (it.rot === 0 ? r.h * 0.9 : r.h * 0.1) : r.h * 0.55;
      return { x: r.x, y: r.y + off - thick / 2, w: r.w, h: thick };
    }
    const off = under ? (it.rot === 90 ? r.w * 0.1 : r.w * 0.9) : r.w * 0.45;
    return { x: r.x + off - thick / 2, y: r.y, w: thick, h: r.h };
  });
}

function markupAppearance(it: MarkupItem): Appearance {
  const res = it.type === "highlight" ? { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply" } } } : {};
  return displayAppearance(itemBounds(it), (L) => {
    let s = (it.type === "highlight" ? "/GS0 gs " : "") + `${rgb(it.color)} rg\n`;
    for (const r of markupBars(it)) s += `${L(r.x, r.y + r.h)} ${f(r.w)} ${f(r.h)} re f\n`;
    return s;
  }, res);
}

function noteAppearance(it: NoteItem): Appearance {
  const S = NOTE_SIZE;
  const ops =
    `${rgb(it.color)} rg 0.25 0.25 0.25 RG 0.8 w 1 1 ${S - 2} ${S - 2} re B\n` +
    `0.2 0.2 0.2 RG 1 w 5 14 m 15 14 l S 5 10 m 15 10 l S 5 6 m 11 6 l S\n`;
  return { ops, resources: {}, nw: S, nh: S, box: { x: it.x, y: it.y, w: S, h: S }, rot: 0 };
}

async function buildAppearance(doc: PDFDocument, it: Item, fonts: FontCache): Promise<Appearance> {
  switch (it.type) {
    case "text": return textAppearance(it, fonts);
    case "rect": {
      const { nw, nh } = naturalSize(it);
      return { ops: `${rgb(it.fill)} rg 0 0 ${f(nw)} ${f(nh)} re f\n`, resources: {}, nw, nh, box: it, rot: it.rot };
    }
    case "image": {
      const { nw, nh } = naturalSize(it);
      const bytes = dataUrlBytes(it.src);
      const img = it.src.startsWith("data:image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      return { ops: `q ${f(nw)} 0 0 ${f(nh)} 0 0 cm /Im0 Do Q\n`, resources: { XObject: { Im0: img.ref } }, nw, nh, box: it, rot: it.rot };
    }
    case "shape": return shapeAppearance(it);
    case "ink": return inkAppearance(it);
    case "note": return noteAppearance(it);
    default: return markupAppearance(it);
  }
}

export function dataUrlBytes(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- writing ----------

export interface WriteOptions { flatten: boolean }

/**
 * Writes items into `bytes` (which should already contain form values) and returns new PDF bytes.
 */
export async function writeItems(bytes: Uint8Array, items: Item[], opts: WriteOptions): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const fonts = new FontCache(doc);
  const pages = doc.getPages();
  const warnings: string[] = [];
  const wrapped = new Set<number>();
  const now = PDFString.fromDate(new Date());

  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    const map = makeMapper(page);
    const ap = await buildAppearance(doc, it, fonts);
    const m = matrixFor(ap.box, ap.rot, ap.nw, ap.nh, map);
    const xobj = ctx.flateStream(ap.ops, {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, ap.nw, ap.nh], Matrix: m, Resources: ap.resources,
    } as never);
    const xref = ctx.register(xobj);

    if (opts.flatten && it.type !== "note") {
      if (!wrapped.has(it.page)) {
        page.node.normalize();
        const start = ctx.register(ctx.stream("q\n"));
        const end = ctx.register(ctx.stream("Q\n"));
        page.node.wrapContentStreams(start, end);
        wrapped.add(it.page);
      }
      const name = page.node.newXObject("Plume", xref);
      page.node.addContentStream(ctx.register(ctx.stream(`q ${name.toString()} Do Q\n`)));
      continue;
    }

    const corners = [applyMat(m, 0, 0), applyMat(m, ap.nw, 0), applyMat(m, 0, ap.nh), applyMat(m, ap.nw, ap.nh)];
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
    const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const color = hexToRgb(isBoxLike(it) && it.type === "rect" ? it.fill : (it as { color: string }).color ?? "#000000");

    const dict: Record<string, unknown> = {
      Type: "Annot",
      Rect: rect,
      AP: { N: xref },
      F: 4,
      NM: PDFString.of(NM_PREFIX + it.id),
      M: now,
      C: color,
      [DATA_KEY]: PDFHexString.fromText(JSON.stringify(it)),
    };
    switch (it.type) {
      case "text":
        Object.assign(dict, {
          Subtype: "FreeText",
          Contents: PDFHexString.fromText(it.text),
          DA: PDFString.of(`/Helv ${f(it.fontSize)} Tf ${rgb(it.color)} rg`),
        });
        delete dict.C;
        break;
      case "rect":
        Object.assign(dict, { Subtype: "Square", IC: color, BS: { W: 0 } });
        break;
      case "image":
      case "shape":
        Object.assign(dict, { Subtype: "Stamp", Name: it.type === "image" && it.signature ? "Signature" : "Plume" });
        break;
      case "ink": {
        Object.assign(dict, {
          Subtype: "Ink",
          InkList: it.paths.map((p) => p.flatMap((q) => map(q.x, q.y))),
          BS: { W: it.width },
        });
        break;
      }
      case "note":
        Object.assign(dict, {
          Subtype: "Text", Name: "Comment", Open: false, Contents: PDFHexString.fromText(it.text),
          T: PDFHexString.fromText("Note"),
        });
        break;
      default: {
        const mk = it as MarkupItem;
        const k = mk.rot / 90;
        const quads = mk.rects.flatMap((r) => {
          const c = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
          const tl = c[k % 4], tr = c[(k + 1) % 4], br = c[(k + 2) % 4], bl = c[(k + 3) % 4];
          return [tl, tr, bl, br].flatMap(([x, y]) => map(x, y));
        });
        Object.assign(dict, {
          Subtype: mk.type === "highlight" ? "Highlight" : mk.type === "underline" ? "Underline" : "StrikeOut",
          QuadPoints: quads,
        });
      }
    }
    const aref = ctx.register(ctx.obj(dict as never));
    let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of("Annots"), annots);
    }
    annots.push(aref);
  }

  if (opts.flatten) {
    try {
      const form = doc.getForm();
      if (form.getFields().length) {
        try { form.flatten({ updateFieldAppearances: false }); }
        catch { form.flatten(); }
      }
    } catch (e) {
      warnings.push("Some form fields could not be flattened: " + (e as Error).message);
    }
    // pdf-lib can leave references to deleted widgets behind; drop them.
    for (const page of pages) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const r = annots.get(i);
        if (r instanceof PDFRef && !ctx.lookup(r)) annots.remove(i);
      }
    }
  }
  return { bytes: await doc.save(), warnings };
}

// ---------- reading our own annotations back ----------

export interface Loaded { bytes: Uint8Array; items: Item[]; encrypted: boolean }

/** Pull our annotations out of the file so they become editable items again. */
export async function extractOwnItems(bytes: Uint8Array): Promise<Loaded> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return { bytes, items: [], encrypted: false }; // let PDF.js try (it is more tolerant)
  }
  if (doc.isEncrypted) return { bytes, items: [], encrypted: true };
  const items: Item[] = [];
  const toDelete: PDFRef[] = [];
  doc.getPages().forEach((page, pi) => {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const raw = annots.get(i);
      const dict = annots.lookupMaybe(i, PDFDict);
      if (!dict) continue;
      const data = dict.get(PDFName.of(DATA_KEY));
      if (!(data instanceof PDFHexString || data instanceof PDFString)) continue;
      try {
        const it = JSON.parse(data.decodeText()) as Item;
        it.page = pi;
        items.push(it);
        annots.remove(i);
        if (raw instanceof PDFRef) toDelete.push(raw);
      } catch { /* not ours / corrupt: leave it */ }
    }
  });
  if (!items.length) return { bytes, items, encrypted: false };
  // Remove the orphaned annotation objects (dict, appearance stream, images, fonts).
  const seen = new Set<string>();
  const walk = (obj: PDFObject | undefined) => {
    if (!obj) return;
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) return;
      seen.add(obj.tag);
      walk(doc.context.lookup(obj));
      doc.context.delete(obj);
    } else if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) if (k.asString() !== "/P" && k.asString() !== "/Parent") walk(v);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) walk(obj.get(i));
    } else if (obj instanceof PDFStream) {
      walk(obj.dict);
    }
  };
  toDelete.forEach(walk);
  items.reverse();
  return { bytes: await doc.save(), items, encrypted: false };
}
