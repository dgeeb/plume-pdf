import { useEffect } from "react";
import { useStore, Tool } from "./store";
import { viewer } from "./pdf/viewer";
import { Item, Rect, MarkupType, uid, isBoxLike } from "./model";
import { openDialog, save, chooseImageForPlacement } from "./actions";
import { finishEdit, startEdit } from "./components/Overlays";

const st = () => useStore.getState();

// ---------- text selection -> highlight / underline / strike ----------

function mergeLineRects(rects: Rect[]): Rect[] {
  if (!rects.length) return [];
  const hs = rects.map((r) => r.h).sort((a, b) => a - b);
  const median = hs[Math.floor(hs.length / 2)];
  const rs = rects.filter((r) => r.h <= median * 2.5 && r.w > 0.3).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.45;
    if (last && sameLine && r.x <= last.x + last.w + Math.max(last.h, r.h) * 0.6) {
      const x0 = Math.min(last.x, r.x), y0 = Math.min(last.y, r.y);
      const x1 = Math.max(last.x + last.w, r.x + r.w), y1 = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else out.push({ ...r });
  }
  return out;
}

/** Convert the current DOM selection into page-space rects grouped by page. */
export function selectionRects(): Map<number, Rect[]> {
  const out = new Map<number, Rect[]>();
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return out;
  const pages = viewer.overlays.map((ov, i) => ({ i, r: ov.isConnected ? ov.getBoundingClientRect() : null }));
  for (let ri = 0; ri < sel.rangeCount; ri++) {
    const range = sel.getRangeAt(ri);
    for (const cr of Array.from(range.getClientRects())) {
      if (cr.width < 1 || cr.height < 1) continue;
      const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
      const pg = pages.find((p) => p.r && cx >= p.r.left && cx <= p.r.right && cy >= p.r.top && cy <= p.r.bottom);
      if (!pg || !pg.r) continue;
      const sz = viewer.pageSizes[pg.i];
      const sx = sz.w / pg.r.width, sy = sz.h / pg.r.height;
      const r = { x: (cr.left - pg.r.left) * sx, y: (cr.top - pg.r.top) * sy, w: cr.width * sx, h: cr.height * sy };
      if (r.w > sz.w * 0.98 && r.h > sz.h * 0.5) continue; // the text layer's end-of-content filler
      if (!out.has(pg.i)) out.set(pg.i, []);
      out.get(pg.i)!.push(r);
    }
  }
  for (const [k, v] of out) out.set(k, mergeLineRects(v));
  return out;
}

export function markupSelection(type: MarkupType): boolean {
  const groups = selectionRects();
  if (!groups.size) return false;
  const style = st().style;
  const color = type === "highlight" ? style.highlight : style.markColor;
  const added: Item[] = [];
  for (const [page, rects] of groups) if (rects.length) added.push({ id: uid(), page, rot: 0, type, rects, color });
  if (!added.length) return false;
  st().commit([...st().items, ...added]);
  window.getSelection()?.removeAllRanges();
  return true;
}

export function useMarkupFromSelection() {
  useEffect(() => {
    const onUp = () => {
      const t = st().tool;
      if (t === "highlight" || t === "underline" || t === "strike") setTimeout(() => markupSelection(t), 0);
    };
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, []);
}

// ---------- keyboard shortcuts ----------

const TOOL_KEYS: Record<string, Tool> = {
  v: "select", t: "text", w: "rect", p: "pen", h: "highlight", u: "underline", k: "strike", n: "note",
};

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function useShortcuts(handlers: { openFind: () => void; openSignature: () => void; openHelp: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = st();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const editable = isEditable(e.target);

      if (mod && key === "o") { e.preventDefault(); openDialog(); return; }
      if (mod && key === "s") {
        e.preventDefault();
        if (editable) (e.target as HTMLElement).blur();
        save(e.shiftKey ? "saveAs" : "save");
        return;
      }
      if (!s.doc) return;
      if (mod && key === "f") { e.preventDefault(); handlers.openFind(); return; }
      if (mod && (key === "=" || key === "+")) { e.preventDefault(); viewer.zoomBy(1.2); return; }
      if (mod && key === "-") { e.preventDefault(); viewer.zoomBy(1 / 1.2); return; }
      if (mod && key === "0") { e.preventDefault(); viewer.setScale("page-width"); return; }
      if (e.key === "F3") { e.preventDefault(); handlers.openFind(); return; }
      if (editable) return;

      if (mod && key === "z" && !e.shiftKey) { e.preventDefault(); s.undo(); return; }
      if (mod && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); s.redo(); return; }
      if (mod) return;

      if (e.key === "Escape") {
        if (s.editingId) finishEdit();
        s.set({ selectedId: null, tool: "select", placement: null });
        window.getSelection()?.removeAllRanges();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedId) { e.preventDefault(); s.deleteItem(s.selectedId); return; }
      if (e.key.startsWith("Arrow") && s.selectedId) {
        const it = s.items.find((i) => i.id === s.selectedId);
        if (it && (isBoxLike(it) || it.type === "note")) {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
          const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
          s.updateItem(it.id, { x: it.x + dx, y: it.y + dy });
        }
        return;
      }
      if (key === "enter" && s.selectedId) {
        const it = s.items.find((i) => i.id === s.selectedId);
        if (it?.type === "text") { e.preventDefault(); startEdit(it.id, s.items, false); }
        return;
      }
      if (TOOL_KEYS[key]) {
        const tool = TOOL_KEYS[key];
        // With text selected, H/U/K mark it immediately.
        if ((tool === "highlight" || tool === "underline" || tool === "strike") && markupSelection(tool)) return;
        s.setTool(tool);
        return;
      }
      if (key === "s") { handlers.openSignature(); return; }
      if (key === "i") { chooseImageForPlacement(); return; }
      if (key === "?" || (e.shiftKey && key === "/")) { handlers.openHelp(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
