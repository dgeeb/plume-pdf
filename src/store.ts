import { create } from "zustand";
import type { Item, FontFamily } from "./model";

export type Tool =
  | "select" | "text" | "rect" | "pen" | "highlight" | "underline" | "strike" | "note"
  | "check" | "cross" | "dot" | "circle" | "date" | "place";

export const STICKY_TOOLS: Tool[] = ["pen", "highlight", "underline", "strike", "check", "cross", "dot", "circle", "date"];

export interface DocInfo {
  name: string;
  path: string | null;
  bytes: Uint8Array;
  encrypted: boolean;
}

export interface Placement { src: string; w: number; h: number; signature?: boolean }

export interface Style {
  color: string; // text / pen / shape color
  font: FontFamily;
  bold: boolean;
  fontSize: number;
  penWidth: number;
  highlight: string;
  markColor: string; // underline/strike color
  fill: string; // white-out color
  noteColor: string;
}

interface Snapshot { bytes: Uint8Array; items: Item[] }

interface State {
  doc: DocInfo | null;
  /** Increments whenever bytes must be (re)loaded into the viewer. */
  loadId: number;
  keepView: boolean;
  items: Item[];
  past: Snapshot[];
  future: Snapshot[];
  saved: Snapshot | null;
  tool: Tool;
  placement: Placement | null;
  selectedId: string | null;
  editingId: string | null;
  style: Style;
  sidebar: boolean;
  findOpen: boolean;
  busy: string | null;
  toast: string | null;

  openDoc(doc: DocInfo, items: Item[]): void;
  closeDoc(): void;
  /** Replace items (and optionally bytes) as one undoable step. */
  commit(items: Item[], bytes?: Uint8Array): void;
  /** Live change without history (drag/resize in progress). */
  setLive(items: Item[]): void;
  /** Close a live change: push `before` to history if anything changed. */
  endLive(before: Item[]): void;
  undo(): void;
  redo(): void;
  markSaved(doc?: Partial<DocInfo>): void;
  setTool(t: Tool): void;
  set(p: Partial<State>): void;
  setStyle(p: Partial<Style>): void;
  updateItem(id: string, patch: Partial<Item>, undoable?: boolean): void;
  deleteItem(id: string): void;
  notify(msg: string): void;
}

const STYLE_KEY = "plume.style";
const defaultStyle: Style = {
  color: "#000000", font: "Helvetica", bold: false, fontSize: 12, penWidth: 2,
  highlight: "#fff176", markColor: "#e53935", fill: "#ffffff", noteColor: "#ffd54f",
};
function loadStyle(): Style {
  try { return { ...defaultStyle, ...JSON.parse(localStorage.getItem(STYLE_KEY) || "{}") }; } catch { return defaultStyle; }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  doc: null,
  loadId: 0,
  keepView: false,
  items: [],
  past: [],
  future: [],
  saved: null,
  tool: "select",
  placement: null,
  selectedId: null,
  editingId: null,
  style: loadStyle(),
  sidebar: true,
  findOpen: false,
  busy: null,
  toast: null,

  openDoc(doc, items) {
    set((s) => ({
      doc, items, past: [], future: [], saved: { bytes: doc.bytes, items }, loadId: s.loadId + 1, keepView: false,
      selectedId: null, editingId: null, tool: "select", placement: null,
    }));
  },
  closeDoc() {
    set({ doc: null, items: [], past: [], future: [], saved: null, selectedId: null, editingId: null });
  },
  commit(items, bytes) {
    const s = get();
    if (!s.doc) return;
    const past = [...s.past, { bytes: s.doc.bytes, items: s.items }].slice(-200);
    if (bytes && bytes !== s.doc.bytes) {
      set({ items, past, future: [], doc: { ...s.doc, bytes }, loadId: s.loadId + 1, keepView: true });
    } else {
      set({ items, past, future: [] });
    }
  },
  setLive(items) { set({ items }); },
  endLive(before) {
    const s = get();
    if (!s.doc || before === s.items) return;
    set({ past: [...s.past, { bytes: s.doc.bytes, items: before }].slice(-200), future: [] });
  },
  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev || !s.doc) return;
    const cur = { bytes: s.doc.bytes, items: s.items };
    const reload = prev.bytes !== s.doc.bytes;
    set({
      past: s.past.slice(0, -1), future: [cur, ...s.future], items: prev.items,
      doc: { ...s.doc, bytes: prev.bytes }, selectedId: null, editingId: null,
      ...(reload ? { loadId: s.loadId + 1, keepView: true } : {}),
    });
  },
  redo() {
    const s = get();
    const next = s.future[0];
    if (!next || !s.doc) return;
    const cur = { bytes: s.doc.bytes, items: s.items };
    const reload = next.bytes !== s.doc.bytes;
    set({
      future: s.future.slice(1), past: [...s.past, cur], items: next.items,
      doc: { ...s.doc, bytes: next.bytes }, selectedId: null, editingId: null,
      ...(reload ? { loadId: s.loadId + 1, keepView: true } : {}),
    });
  },
  markSaved(patch) {
    const s = get();
    if (!s.doc) return;
    const doc = { ...s.doc, ...patch };
    set({ doc, saved: { bytes: doc.bytes, items: s.items } });
  },
  setTool(tool) {
    set({ tool, placement: tool === "place" ? get().placement : null, selectedId: null, editingId: null });
  },
  set(p) { set(p); },
  setStyle(p) {
    const style = { ...get().style, ...p };
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* ignore */ }
    set({ style });
  },
  updateItem(id, patch, undoable = true) {
    const s = get();
    const items = s.items.map((it) => (it.id === id ? ({ ...it, ...patch } as Item) : it));
    if (undoable) s.commit(items); else s.setLive(items);
  },
  deleteItem(id) {
    const s = get();
    s.commit(s.items.filter((it) => it.id !== id));
    set({ selectedId: null, editingId: null });
  },
  notify(msg) {
    clearTimeout(toastTimer);
    set({ toast: msg });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

export function isDirty(s: { doc: DocInfo | null; items: Item[]; saved: Snapshot | null }, formsModified: boolean) {
  if (!s.doc || !s.saved) return false;
  return formsModified || s.doc.bytes !== s.saved.bytes || s.items !== s.saved.items;
}
