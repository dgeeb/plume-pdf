// Core data model. All geometry is in PDF points, in the page's *display* space
// (top-left origin, y down, at the page's current rotation, scale 1).

export type Rot = 0 | 90 | 180 | 270;
export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export type FontFamily = "Helvetica" | "Times" | "Courier";
export type ShapeKind = "check" | "cross" | "dot" | "circle";

interface Base {
  id: string;
  page: number; // 0-based
  /** Orientation of the item's content relative to the displayed page (clockwise). */
  rot: Rot;
}

export interface TextItem extends Base, Rect {
  type: "text";
  text: string;
  font: FontFamily;
  bold: boolean;
  fontSize: number;
  color: string;
}
export interface BoxItem extends Base, Rect {
  type: "rect"; // white-out / filled box
  fill: string;
}
export interface ImageItem extends Base, Rect {
  type: "image";
  src: string; // data URL (png or jpeg)
  signature?: boolean;
}
export interface ShapeItem extends Base, Rect {
  type: "shape";
  shape: ShapeKind;
  color: string;
}
export interface InkItem extends Base {
  type: "ink";
  paths: Pt[][];
  color: string;
  width: number;
}
export type MarkupType = "highlight" | "underline" | "strike";
export interface MarkupItem extends Base {
  type: MarkupType;
  rects: Rect[];
  color: string;
}
export interface NoteItem extends Base {
  type: "note";
  x: number;
  y: number;
  text: string;
  color: string;
}

export type Item = TextItem | BoxItem | ImageItem | ShapeItem | InkItem | MarkupItem | NoteItem;
export type BoxLike = TextItem | BoxItem | ImageItem | ShapeItem;

export const NOTE_SIZE = 20;
export const TEXT_PAD = 2;
export const LINE_HEIGHT = 1.2;

export function isBoxLike(it: Item): it is BoxLike {
  return it.type === "text" || it.type === "rect" || it.type === "image" || it.type === "shape";
}
export function isMarkup(it: Item): it is MarkupItem {
  return it.type === "highlight" || it.type === "underline" || it.type === "strike";
}

let counter = 0;
export function uid(): string {
  counter++;
  return Date.now().toString(36) + "-" + counter.toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

/** Axis-aligned bounding box of an item in display space. */
export function itemBounds(it: Item): Rect {
  if (isBoxLike(it)) return { x: it.x, y: it.y, w: it.w, h: it.h };
  if (it.type === "note") return { x: it.x, y: it.y, w: NOTE_SIZE, h: NOTE_SIZE };
  if (it.type === "ink") {
    const pad = it.width / 2;
    return boundsOfPoints(it.paths.flat(), pad);
  }
  return unionRects(it.rects);
}

export function boundsOfPoints(pts: Pt[], pad = 0): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

export function unionRects(rs: Rect[]): Rect {
  return boundsOfPoints(rs.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]));
}

/** Natural (unrotated content) size of a box item. */
export function naturalSize(it: { w: number; h: number; rot: Rot }): { nw: number; nh: number } {
  return it.rot === 90 || it.rot === 270 ? { nw: it.h, nh: it.w } : { nw: it.w, nh: it.h };
}

// ---------- Page rotation: move items with the page ----------

function rotPt(p: Pt, W: number, H: number, cw: boolean): Pt {
  return cw ? { x: H - p.y, y: p.x } : { x: p.y, y: W - p.x };
}
function rotRect(r: Rect, W: number, H: number, cw: boolean): Rect {
  return cw
    ? { x: H - r.y - r.h, y: r.x, w: r.h, h: r.w }
    : { x: r.y, y: W - r.x - r.w, w: r.h, h: r.w };
}

/** Transform an item when its page (display size W×H) is rotated 90° cw or ccw. */
export function rotateItem(it: Item, W: number, H: number, cw: boolean): Item {
  const rot = (((it.rot + (cw ? 90 : 270)) % 360) as Rot);
  if (isBoxLike(it)) return { ...it, ...rotRect(it, W, H, cw), rot };
  if (it.type === "note") {
    const r = rotRect({ x: it.x, y: it.y, w: NOTE_SIZE, h: NOTE_SIZE }, W, H, cw);
    return { ...it, x: r.x, y: r.y, rot };
  }
  if (it.type === "ink") return { ...it, paths: it.paths.map((p) => p.map((q) => rotPt(q, W, H, cw))), rot };
  return { ...it, rects: it.rects.map((r) => rotRect(r, W, H, cw)), rot };
}

// ---------- Colors ----------

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
