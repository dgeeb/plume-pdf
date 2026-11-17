import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw, RotateCw, Trash2, FileOutput, FilePlus2 } from "lucide-react";
import { viewer } from "../pdf/viewer";
import { rotate, removePages, reorder, extract, insertPdfs } from "../actions";

export function Sidebar() {
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const loadId = viewer.docId;
  const n = viewer.pageSizes.length;
  const [sel, setSel] = useState<number[]>([]);
  const [anchor, setAnchor] = useState(0);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = viewer.pageNumber - 1;

  useEffect(() => { setSel([]); }, [loadId]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const targets = sel.length ? sel : [current];
  const label = targets.length > 1 ? `${targets.length} pages` : `page ${targets[0] + 1}`;

  const click = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSel(Array.from({ length: b - a + 1 }, (_, j) => a + j));
    } else if (e.ctrlKey || e.metaKey) {
      setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]);
      setAnchor(i);
    } else {
      setSel([]);
      setAnchor(i);
      viewer.goToPage(i + 1);
    }
  };

  const drop = (to: number) => {
    if (!drag || drag.from === to) { setDrag(null); return; }
    const order = Array.from({ length: n }, (_, i) => i);
    order.splice(drag.from, 1);
    order.splice(to > drag.from ? to - 1 : to, 0, drag.from);
    setDrag(null);
    reorder(order);
  };

  return (
    <aside className="sidebar">
      <div className="sb-tools">
        <button className="tb-btn small" title={`Rotate ${label} left`} onClick={() => rotate(targets, false)}><RotateCcw size={16} /></button>
        <button className="tb-btn small" title={`Rotate ${label} right`} onClick={() => rotate(targets, true)}><RotateCw size={16} /></button>
        <button className="tb-btn small" title={`Delete ${label}`} onClick={() => removePages(targets)}><Trash2 size={16} /></button>
        <button className="tb-btn small" title={`Extract ${label} to a new PDF`} onClick={() => extract(targets)}><FileOutput size={16} /></button>
        <button className="tb-btn small" title="Add pages from another PDF (merge)" onClick={() => insertPdfs()}><FilePlus2 size={16} /></button>
      </div>
      <div className="sb-hint">{sel.length ? `${sel.length} selected · Ctrl/Shift-click to select` : "Ctrl/Shift-click to select pages · drag to reorder"}</div>
      <div className="sb-list" ref={listRef}>
        {Array.from({ length: n }, (_, i) => (
          <div
            key={`${loadId}-${i}`}
            data-thumb={i}
            className={`thumb${i === current ? " current" : ""}${sel.includes(i) ? " selected" : ""}${drag?.over === i ? " drop-before" : ""}`}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDrag({ from: i, over: null }); }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const over = e.clientY > r.top + r.height / 2 ? i + 1 : i;
              if (over !== drag.over) setDrag({ ...drag, over });
            }}
            onDrop={(e) => { e.preventDefault(); if (drag?.over != null) drop(drag.over); }}
            onDragEnd={() => setDrag(null)}
            onClick={(e) => click(i, e)}
          >
            <Thumb index={i} />
            <span className="thumb-num">{i + 1}</span>
          </div>
        ))}
        <div className={`thumb-end${drag?.over === n ? " drop-before" : ""}`}
          onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== n) setDrag({ ...drag, over: n }); } }}
          onDrop={(e) => { e.preventDefault(); drop(n); }} />
      </div>
    </aside>
  );
}

const THUMB_W = 132;

function Thumb({ index }: { index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = viewer.pageSizes[index];
  const h = size ? (THUMB_W * size.h) / size.w : THUMB_W * 1.3;
  useEffect(() => {
    const canvas = ref.current;
    const doc = viewer.doc;
    if (!canvas || !doc) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      try {
        const page = await doc.getPage(index + 1);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const vp = page.getViewport({ scale: (THUMB_W * dpr) / page.getViewport({ scale: 1 }).width });
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
        await task.promise;
      } catch { /* cancelled or failed */ }
    }, { rootMargin: "200px" });
    io.observe(canvas);
    return () => { cancelled = true; io.disconnect(); task?.cancel(); };
  }, [index]);
  return <canvas ref={ref} className="thumb-canvas" style={{ width: THUMB_W, height: h }} />;
}
