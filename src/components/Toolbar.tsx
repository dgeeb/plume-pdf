import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  FolderOpen, Save, ChevronDown, Undo2, Redo2, MousePointer2, Type, Eraser, PenLine, Highlighter, Underline,
  Strikethrough, StickyNote, Stamp, Check, X, Circle, Dot, CalendarDays, Signature, ImagePlus, ZoomIn, ZoomOut,
  Search, Sun, Moon, Monitor, PanelLeft, CircleHelp, FilePlus2, FileText,
} from "lucide-react";
import { useStore, Tool } from "../store";
import { viewer } from "../pdf/viewer";
import { openDialog, save, chooseImageForPlacement, insertPdfs, closeDocument } from "../actions";
import { markupSelection } from "../hooks";

export type Theme = "system" | "light" | "dark";

function Btn({ title, onClick, active, disabled, children, wide }: {
  title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode; wide?: boolean;
}) {
  return (
    <button className={`tb-btn${active ? " active" : ""}${wide ? " wide" : ""}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Menu({ label, title, children, active }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`tb-btn menu-btn${active ? " active" : ""}`} title={title} aria-label={title} onClick={() => setOpen(!open)}>
        {label}<ChevronDown size={12} />
      </button>
      {open && <div className="menu-pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ onClick, children, kbd }: { onClick: () => void; children: ReactNode; kbd?: string }) {
  return <button className="menu-item" onClick={onClick}>{children}{kbd && <kbd>{kbd}</kbd>}</button>;
}

const STAMP_TOOLS: Tool[] = ["check", "cross", "dot", "circle", "date"];
const STAMP_ICON: Record<string, ReactNode> = {
  check: <Check size={18} />, cross: <X size={18} />, dot: <Dot size={18} />, circle: <Circle size={18} />, date: <CalendarDays size={18} />,
};

export function Toolbar({ theme, setTheme, onFind, onSignature, onHelp }: {
  theme: Theme; setTheme: (t: Theme) => void; onFind: () => void; onSignature: () => void; onHelp: () => void;
}) {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const sidebar = useStore((s) => s.sidebar);
  const set = useStore((s) => s.set);
  const setTool = useStore((s) => s.setTool);
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const has = !!doc;
  const pct = Math.round(viewer.scale * 100);

  const markTool = (t: "highlight" | "underline" | "strike") => {
    if (!markupSelection(t)) setTool(tool === t ? "select" : t);
  };
  const pick = (t: Tool) => setTool(tool === t ? "select" : t);

  return (
    <header className="toolbar">
      <div className="tb-group">
        <Btn title="Toggle page panel" onClick={() => set({ sidebar: !sidebar })} active={sidebar && has} disabled={!has}><PanelLeft size={18} /></Btn>
        <Btn title="Open PDF (Ctrl+O)" onClick={() => openDialog()}><FolderOpen size={18} /></Btn>
        <Menu title="Save" label={<Save size={18} />}>
          {(close) => (<>
            <MenuItem kbd="Ctrl+S" onClick={() => { close(); save("save"); }}>Save</MenuItem>
            <MenuItem kbd="Ctrl+Shift+S" onClick={() => { close(); save("saveAs"); }}>Save As…</MenuItem>
            <MenuItem onClick={() => { close(); save("flatten"); }}>Save flattened copy…</MenuItem>
            <div className="menu-sep" />
            <MenuItem onClick={() => { close(); insertPdfs(); }}><FilePlus2 size={14} /> Add pages from PDF…</MenuItem>
            <MenuItem onClick={() => { close(); closeDocument(); }}><FileText size={14} /> Close document</MenuItem>
          </>)}
        </Menu>
      </div>
      {has && (<>
        <div className="tb-group">
          <Btn title="Undo (Ctrl+Z)" onClick={() => useStore.getState().undo()} disabled={!canUndo}><Undo2 size={18} /></Btn>
          <Btn title="Redo (Ctrl+Y)" onClick={() => useStore.getState().redo()} disabled={!canRedo}><Redo2 size={18} /></Btn>
        </div>
        <div className="tb-group tools">
          <Btn title="Select & fill forms (V)" onClick={() => setTool("select")} active={tool === "select"}><MousePointer2 size={18} /></Btn>
          <Btn title="Add text (T)" onClick={() => pick("text")} active={tool === "text"}><Type size={18} /></Btn>
          <Btn title="White-out box (W): drag over text to hide it" onClick={() => pick("rect")} active={tool === "rect"}><Eraser size={18} /></Btn>
          <Btn title="Highlight (H)" onClick={() => markTool("highlight")} active={tool === "highlight"}><Highlighter size={18} /></Btn>
          <Btn title="Underline (U)" onClick={() => markTool("underline")} active={tool === "underline"}><Underline size={18} /></Btn>
          <Btn title="Strikethrough (K)" onClick={() => markTool("strike")} active={tool === "strike"}><Strikethrough size={18} /></Btn>
          <Btn title="Pen (P)" onClick={() => pick("pen")} active={tool === "pen"}><PenLine size={18} /></Btn>
          <Btn title="Sticky note (N)" onClick={() => pick("note")} active={tool === "note"}><StickyNote size={18} /></Btn>
          <Menu title="Stamps: check, cross, dot, circle, date" active={STAMP_TOOLS.includes(tool)}
            label={STAMP_TOOLS.includes(tool) ? STAMP_ICON[tool] : <Stamp size={18} />}>
            {(close) => (<>
              <MenuItem onClick={() => { close(); setTool("check"); }}><Check size={14} /> Check mark</MenuItem>
              <MenuItem onClick={() => { close(); setTool("cross"); }}><X size={14} /> Cross</MenuItem>
              <MenuItem onClick={() => { close(); setTool("dot"); }}><Dot size={14} /> Dot</MenuItem>
              <MenuItem onClick={() => { close(); setTool("circle"); }}><Circle size={14} /> Circle</MenuItem>
              <MenuItem onClick={() => { close(); setTool("date"); }}><CalendarDays size={14} /> Today's date</MenuItem>
            </>)}
          </Menu>
          <Btn title="Signature (S)" onClick={onSignature} active={tool === "place" && !!useStore.getState().placement?.signature}><Signature size={18} /></Btn>
          <Btn title="Insert image (I)" onClick={() => chooseImageForPlacement()}><ImagePlus size={18} /></Btn>
        </div>
        <div className="tb-group">
          <Btn title="Zoom out (Ctrl+-)" onClick={() => viewer.zoomBy(1 / 1.2)}><ZoomOut size={18} /></Btn>
          <Menu title="Zoom" label={<span className="zoom-label">{pct}%</span>}>
            {(close) => (<>
              <MenuItem kbd="Ctrl+0" onClick={() => { close(); viewer.setScale("page-width"); }}>Fit width</MenuItem>
              <MenuItem onClick={() => { close(); viewer.setScale("page-fit"); }}>Fit page</MenuItem>
              {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
                <MenuItem key={z} onClick={() => { close(); viewer.setScale(z); }}>{z * 100}%</MenuItem>
              ))}
            </>)}
          </Menu>
          <Btn title="Zoom in (Ctrl++)" onClick={() => viewer.zoomBy(1.2)}><ZoomIn size={18} /></Btn>
          <PageBox />
        </div>
      </>)}
      <div className="tb-spacer" />
      <div className="tb-group">
        {has && <Btn title="Find text (Ctrl+F)" onClick={onFind}><Search size={18} /></Btn>}
        <Btn title={`Theme: ${theme}`} onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}>
          {theme === "light" ? <Sun size={18} /> : theme === "dark" ? <Moon size={18} /> : <Monitor size={18} />}
        </Btn>
        <Btn title="Keyboard shortcuts (?)" onClick={onHelp}><CircleHelp size={18} /></Btn>
      </div>
    </header>
  );
}

function PageBox() {
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const [val, setVal] = useState<string | null>(null);
  const n = viewer.pageSizes.length;
  return (
    <div className="pagebox">
      <input
        value={val ?? String(viewer.pageNumber)}
        onChange={(e) => setVal(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setVal(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { viewer.goToPage(parseInt(val ?? "", 10) || 1); setVal(null); (e.target as HTMLInputElement).blur(); }
        }}
        aria-label="Page number"
      />
      <span>/ {n}</span>
    </div>
  );
}
