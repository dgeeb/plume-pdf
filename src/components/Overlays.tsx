import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { viewer } from "../pdf/viewer";
import { useStore, STICKY_TOOLS } from "../store";
import {
  Item, BoxLike, TextItem, InkItem, MarkupItem, NoteItem, ShapeItem, Pt, Rect,
  uid, naturalSize, isBoxLike, isMarkup, itemBounds, NOTE_SIZE, TEXT_PAD, LINE_HEIGHT,
} from "../model";
import { CSS_FONT, fitText } from "../lib/text";
import { SHAPE_PATHS, shapeStroke, markupBars } from "../pdf/pdfWrite";

const k = (v: number) => `calc(var(--scale-factor) * ${v}px)`;
const st = () => useStore.getState();

export function Overlays() {
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const loadId = viewer.docId;
  return <>{viewer.overlays.map((el, i) => createPortal(<PageOverlay page={i} />, el, `${loadId}-${i}`))}</>;
}

// ---------- editing session (text & notes) ----------

let editBefore: { id: string; items: Item[]; isNew: boolean } | null = null;

export function startEdit(id: string, before: Item[], isNew: boolean) {
  editBefore = { id, items: before, isNew };
  st().set({ editingId: id, selectedId: id });
}

export function finishEdit() {
  const s = st();
  const id = s.editingId;
  if (!id) return;
  const it = s.items.find((i) => i.id === id);
  const sess = editBefore && editBefore.id === id ? editBefore : null;
  editBefore = null;
  s.set({ editingId: null });
  if (!sess) return;
  if (it && it.type === "text" && !it.text.trim()) {
    if (sess.isNew) s.setLive(sess.items);
    else { s.setLive(s.items.filter((i) => i.id !== id)); s.endLive(sess.items); }
    s.set({ selectedId: null });
    return;
  }
  s.endLive(sess.items);
}

// ---------- page overlay ----------

function PageOverlay({ page }: { page: number }) {
  const allItems = useStore((s) => s.items);
  const tool = useStore((s) => s.tool);
  const placement = useStore((s) => s.placement);
  const style = useStore((s) => s.style);
  const items = useMemo(() => allItems.filter((i) => i.page === page), [allItems, page]);
  const root = useRef<HTMLDivElement>(null);
  const size = viewer.pageSizes[page] ?? { w: 612, h: 792 };
  const [draft, setDraft] = useState<{ kind: "rect"; a: Pt; b: Pt } | { kind: "pen"; pts: Pt[] } | null>(null);
  const [ghost, setGhost] = useState<Pt | null>(null);

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = root.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };
  const creating = tool !== "select" && tool !== "highlight" && tool !== "underline" && tool !== "strike";

  const add = (it: Item, select = true) => {
    const s = st();
    s.commit([...s.items, it]);
    if (select) s.set({ selectedId: it.id });
    if (!STICKY_TOOLS.includes(s.tool)) s.set({ tool: "select", placement: null });
  };

  const onDown = (e: RPE<HTMLDivElement>) => {
    if (!creating || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = toPt(e);
    const base = { id: uid(), page, rot: 0 as const };
    switch (tool) {
      case "text": {
        const t: TextItem = { ...base, type: "text", text: "", font: style.font, bold: style.bold, fontSize: style.fontSize, color: style.color, x: p.x - TEXT_PAD, y: p.y - style.fontSize * 0.75, w: 0, h: 0 };
        Object.assign(t, fitText(t));
        const before = st().items;
        st().setLive([...before, t]);
        st().set({ tool: "select" });
        startEdit(t.id, before, true);
        return;
      }
      case "date": {
        const t: TextItem = { ...base, type: "text", text: new Date().toLocaleDateString(), font: style.font, bold: style.bold, fontSize: style.fontSize, color: style.color, x: p.x - TEXT_PAD, y: p.y - style.fontSize * 0.75, w: 0, h: 0 };
        add({ ...t, ...fitText(t) });
        return;
      }
      case "note": {
        const n: NoteItem = { ...base, type: "note", x: p.x - NOTE_SIZE / 2, y: p.y - NOTE_SIZE / 2, text: "", color: style.noteColor };
        const before = st().items;
        st().setLive([...before, n]);
        st().set({ tool: "select" });
        startEdit(n.id, before, true);
        return;
      }
      case "check": case "cross": case "dot": case "circle": {
        const d = tool === "dot" ? style.fontSize * 0.6 : tool === "circle" ? style.fontSize * 1.6 : style.fontSize * 1.1;
        const sh: ShapeItem = { ...base, type: "shape", shape: tool, color: style.color, x: p.x - d / 2, y: p.y - d / 2, w: d, h: d };
        add(sh, false);
        return;
      }
      case "place": {
        if (!placement) return;
        add({ ...base, type: "image", src: placement.src, signature: placement.signature, x: p.x - placement.w / 2, y: p.y - placement.h / 2, w: placement.w, h: placement.h });
        setGhost(null);
        return;
      }
      case "rect":
        setDraft({ kind: "rect", a: p, b: p });
        break;
      case "pen":
        setDraft({ kind: "pen", pts: [p] });
        break;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPE<HTMLDivElement>) => {
    if (tool === "place") { setGhost(toPt(e)); return; }
    if (!draft) return;
    const p = toPt(e);
    if (draft.kind === "rect") setDraft({ ...draft, b: p });
    else {
      const last = draft.pts[draft.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.6) setDraft({ kind: "pen", pts: [...draft.pts, p] });
    }
  };

  const onUp = () => {
    if (!draft) return;
    const base = { id: uid(), page, rot: 0 as const };
    if (draft.kind === "rect") {
      let r: Rect = { x: Math.min(draft.a.x, draft.b.x), y: Math.min(draft.a.y, draft.b.y), w: Math.abs(draft.b.x - draft.a.x), h: Math.abs(draft.b.y - draft.a.y) };
      if (r.w < 3 || r.h < 3) r = { x: draft.a.x, y: draft.a.y - 8, w: 100, h: 16 };
      add({ ...base, type: "rect", fill: style.fill, ...r });
    } else {
      add({ ...base, type: "ink", paths: [simplify(draft.pts)], color: style.color, width: style.penWidth }, false);
    }
    setDraft(null);
  };

  return (
    <div
      ref={root}
      className={`pl-root tool-${tool}${creating ? " creating" : ""}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setGhost(null)}
    >
      {/* markup underneath everything else */}
      {items.filter(isMarkup).map((it) => <MarkupView key={it.id} it={it} toPt={toPt} />)}
      <svg className="pl-ink" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        {items.filter((i): i is InkItem => i.type === "ink").map((it) => <InkView key={it.id} it={it} toPt={toPt} />)}
        {draft?.kind === "pen" && (
          <path d={pathD(draft.pts)} stroke={style.color} strokeWidth={style.penWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {items.filter(isBoxLike).map((it) => <BoxView key={it.id} it={it} toPt={toPt} />)}
      {items.filter((i): i is NoteItem => i.type === "note").map((it) => <NoteView key={it.id} it={it} toPt={toPt} />)}
      {draft?.kind === "rect" && (
        <div className="pl-draft" style={{
          left: k(Math.min(draft.a.x, draft.b.x)), top: k(Math.min(draft.a.y, draft.b.y)),
          width: k(Math.abs(draft.b.x - draft.a.x)), height: k(Math.abs(draft.b.y - draft.a.y)), background: style.fill,
        }} />
      )}
      {tool === "place" && placement && ghost && (
        <img className="pl-ghost" src={placement.src} draggable={false} style={{
          left: k(ghost.x - placement.w / 2), top: k(ghost.y - placement.h / 2), width: k(placement.w), height: k(placement.h),
        }} />
      )}
      <SelectionBox items={items} />
    </div>
  );
}

function pathD(pts: Pt[]) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y} l0.01 0`;
  return "M" + pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L");
}

/** Drop points closer than tolerance to the line (Ramer–Douglas–Peucker, tiny tolerance). */
function simplify(pts: Pt[], tol = 0.35): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const A = pts[a], B = pts[b];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((B.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (B.y - A.y)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- drag helpers ----------

type ToPt = (e: { clientX: number; clientY: number }) => Pt;

function translate(it: Item, dx: number, dy: number): Item {
  if (isBoxLike(it) || it.type === "note") return { ...it, x: it.x + dx, y: it.y + dy };
  if (it.type === "ink") return { ...it, paths: it.paths.map((p) => p.map((q) => ({ x: q.x + dx, y: q.y + dy }))) };
  return it; // markup stays attached to its text
}

function useDrag(it: Item, toPt: ToPt) {
  return (e: RPE<Element>) => {
    const s = st();
    if (s.tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    if (s.editingId === it.id) return;
    if (s.editingId) finishEdit();
    st().set({ selectedId: it.id });
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = toPt(e);
    const before = st().items;
    const orig = it;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = toPt(ev);
      const dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) < 1.5) return;
      moved = true;
      const next = translate(orig, dx, dy);
      st().setLive(before.map((i) => (i.id === orig.id ? next : i)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved) st().endLive(before);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

function startResize(e: RPE<HTMLElement>, it: BoxLike, toPt: ToPt) {
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const start = toPt(e);
  const before = st().items;
  const keepRatio = it.type !== "rect";
  const move = (ev: PointerEvent) => {
    const p = toPt(ev);
    let w = Math.max(4, it.w + p.x - start.x);
    let h = Math.max(4, it.h + p.y - start.y);
    if (keepRatio && !ev.shiftKey) {
      const s = Math.max(w / it.w, h / it.h);
      w = it.w * s; h = it.h * s;
    }
    let next: Item;
    if (it.type === "text") {
      const vertical = it.rot === 90 || it.rot === 270;
      const fontSize = Math.max(4, Math.round(it.fontSize * (vertical ? w / it.w : h / it.h) * 2) / 2);
      next = { ...it, fontSize };
      Object.assign(next, fitText(next as TextItem));
    } else next = { ...it, w, h };
    st().setLive(before.map((i) => (i.id === it.id ? next : i)));
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    st().endLive(before);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

// ---------- item views ----------

function BoxView({ it, toPt }: { it: BoxLike; toPt: ToPt }) {
  const selected = useStore((s) => s.selectedId === it.id);
  const editing = useStore((s) => s.editingId === it.id);
  const onDown = useDrag(it, toPt);
  const { nw, nh } = naturalSize(it);
  return (
    <div
      className={`pl-item pl-${it.type}${selected ? " selected" : ""}`}
      style={{ left: k(it.x), top: k(it.y), width: k(it.w), height: k(it.h) }}
      onPointerDown={onDown}
      onDoubleClick={() => { if (it.type === "text" && st().tool === "select") startEdit(it.id, st().items, false); }}
    >
      <div className="pl-inner" style={{ width: k(nw), height: k(nh), transform: `translate(-50%, -50%) rotate(${it.rot}deg)` }}>
        {it.type === "text" && (editing ? <TextEditor it={it} /> : <TextBody it={it} />)}
        {it.type === "rect" && <div className="pl-fill" style={{ background: it.fill }} />}
        {it.type === "image" && <img src={it.src} draggable={false} alt="" />}
        {it.type === "shape" && <ShapeSvg it={it} nw={nw} nh={nh} />}
      </div>
      {selected && !editing && <div className="pl-handle" onPointerDown={(e) => startResize(e, it, toPt)} />}
    </div>
  );
}

function textStyle(it: TextItem): React.CSSProperties {
  return {
    fontFamily: CSS_FONT[it.font], fontWeight: it.bold ? 700 : 400, fontSize: k(it.fontSize),
    lineHeight: LINE_HEIGHT, padding: k(TEXT_PAD), color: it.color,
  };
}

function TextBody({ it }: { it: TextItem }) {
  return <div className="pl-text" style={textStyle(it)}>{it.text || " "}</div>;
}

function TextEditor({ it }: { it: TextItem }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current!;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="pl-text pl-textedit"
      style={textStyle(it)}
      value={it.text}
      spellCheck={false}
      wrap="off"
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = { ...it, text: e.target.value };
        st().updateItem(it.id, { text: next.text, ...fitText(next) }, false);
      }}
      onBlur={finishEdit}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ref.current?.blur(); }
      }}
    />
  );
}

function ShapeSvg({ it, nw, nh }: { it: ShapeItem; nw: number; nh: number }) {
  const sw = shapeStroke(nw, nh);
  const r = Math.min(nw, nh) / 2;
  return (
    <svg viewBox={`0 0 ${nw} ${nh}`} width="100%" height="100%" style={{ overflow: "visible" }}>
      {it.shape === "dot" && <circle cx={nw / 2} cy={nh / 2} r={r} fill={it.color} />}
      {it.shape === "circle" && <circle cx={nw / 2} cy={nh / 2} r={r - sw * 0.3} fill="none" stroke={it.color} strokeWidth={sw * 0.6} />}
      {(it.shape === "check" || it.shape === "cross") && SHAPE_PATHS[it.shape].map((poly, i) => (
        <polyline key={i} points={poly.map(([x, y]) => `${x * nw},${y * nh}`).join(" ")} fill="none" stroke={it.color}
          strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function InkView({ it, toPt }: { it: InkItem; toPt: ToPt }) {
  const onDown = useDrag(it, toPt);
  const d = it.paths.map(pathD).join(" ");
  return (
    <g className="pl-inkitem" onPointerDown={onDown}>
      <path d={d} stroke="transparent" strokeWidth={Math.max(8, it.width + 6)} fill="none" strokeLinecap="round" />
      <path d={d} stroke={it.color} strokeWidth={it.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function MarkupView({ it, toPt }: { it: MarkupItem; toPt: ToPt }) {
  const onDown = useDrag(it, toPt);
  return (
    <>
      {markupBars(it).map((r, i) => (
        <div key={i} className={`pl-mark pl-${it.type}`} onPointerDown={onDown}
          style={{ left: k(r.x), top: k(r.y), width: k(r.w), height: k(r.h), background: it.color }} />
      ))}
    </>
  );
}

function NoteView({ it, toPt }: { it: NoteItem; toPt: ToPt }) {
  const editing = useStore((s) => s.editingId === it.id);
  const selected = useStore((s) => s.selectedId === it.id);
  const onDown = useDrag(it, toPt);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  return (
    <>
      <div
        className={`pl-note${selected ? " selected" : ""}`}
        title={it.text || "Empty note"}
        style={{ left: k(it.x), top: k(it.y), width: k(NOTE_SIZE), height: k(NOTE_SIZE), background: it.color }}
        onPointerDown={onDown}
        onClick={() => { if (st().tool === "select" && !editing) startEdit(it.id, st().items, false); }}
      >
        <svg viewBox="0 0 20 20" width="100%" height="100%"><path d="M5 6h10M5 10h10M5 14h6" stroke="#333" strokeWidth="1.2" /></svg>
      </div>
      {editing && (
        <div className="pl-notepop" style={{ left: `calc(var(--scale-factor) * ${it.x + NOTE_SIZE + 4}px)`, top: k(it.y) }}
          onPointerDown={(e) => e.stopPropagation()}>
          <textarea ref={ref} value={it.text} placeholder="Write a comment…"
            onChange={(e) => st().updateItem(it.id, { text: e.target.value }, false)}
            onBlur={finishEdit}
            onKeyDown={(e) => { if (e.key === "Escape") ref.current?.blur(); }} />
          <div className="pl-notebar">
            <span>Note</span>
            <button title="Delete note" onMouseDown={(e) => { e.preventDefault(); editBefore = null; st().set({ editingId: null }); st().deleteItem(it.id); }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SelectionBox({ items }: { items: Item[] }) {
  const sel = useStore((s) => s.selectedId);
  const it = items.find((i) => i.id === sel);
  if (!it || isBoxLike(it) || it.type === "note") return null;
  const b = itemBounds(it);
  return <div className="pl-selbox" style={{ left: k(b.x - 2), top: k(b.y - 2), width: k(b.w + 4), height: k(b.h + 4) }} />;
}
