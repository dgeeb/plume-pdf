import { useEffect, useState } from "react";
import { X, FolderOpen, Files, FileText } from "lucide-react";
import { getRecent, removeRecent, isTauri, Recent } from "../lib/platform";
import { openDialog, openPath } from "../actions";

const SHORTCUTS: [string, string][] = [
  ["Ctrl+O", "Open (select several files to combine them)"],
  ["Ctrl+S / Ctrl+Shift+S", "Save / Save As"],
  ["Ctrl+F, Enter, Shift+Enter", "Find, next, previous"],
  ["Ctrl+Z / Ctrl+Y", "Undo / Redo"],
  ["Ctrl + / Ctrl − / Ctrl 0", "Zoom in / out / fit width (Ctrl+wheel works too)"],
  ["V", "Select, fill forms"],
  ["T", "Add text"],
  ["W", "White-out box"],
  ["H / U / K", "Highlight / underline / strikethrough (applies to selected text)"],
  ["P", "Pen"],
  ["N", "Sticky note"],
  ["S", "Signature"],
  ["I", "Insert image"],
  ["Enter", "Edit selected text box"],
  ["Arrows (+Shift)", "Nudge selected item by 1 pt (10 pt)"],
  ["Delete", "Delete selected item"],
  ["Esc", "Back to Select tool / deselect"],
];

function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  useEsc(onClose);
  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts">
        <div className="modal-head"><h2>Keyboard shortcuts</h2><button className="tb-btn small" onClick={onClose}><X size={16} /></button></div>
        <table className="shortcuts"><tbody>
          {SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}

export function PasswordDialog({ onDone }: { onDone: (pw: string | null) => void }) {
  const [pw, setPw] = useState("");
  useEsc(() => onDone(null));
  return (
    <div className="modal-back">
      <form className="modal small" onSubmit={(e) => { e.preventDefault(); onDone(pw); }}>
        <div className="modal-head"><h2>Password required</h2></div>
        <p>This PDF is protected. Enter its password to open it.</p>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="wide-input" />
        <div className="modal-foot">
          <div className="tb-spacer" />
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary">Open</button>
        </div>
      </form>
    </div>
  );
}

export function Welcome() {
  const [recent, setRecent] = useState<Recent[]>(getRecent);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo"><FileText size={36} /></div>
        <h1>Plume PDF</h1>
        <p className="muted">Open, fill, sign and annotate PDFs.</p>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => openDialog(false)}><FolderOpen size={18} /> Open PDF</button>
          <button className="btn big" onClick={() => openDialog(true)} title="Pick several PDFs to merge them into one"><Files size={18} /> Combine PDFs</button>
        </div>
        <p className="muted small">…or drop a PDF anywhere in this window.</p>
        {isTauri && recent.length > 0 && (
          <div className="recent">
            <h3>Recent files</h3>
            {recent.map((r) => (
              <div key={r.path} className="recent-row">
                <button className="recent-open" onClick={() => openPath(r.path)} title={r.path}>
                  <FileText size={16} />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.path.replace(/[\\/][^\\/]*$/, "")}</span>
                </button>
                <button className="tb-btn small" title="Remove from list" onClick={() => { removeRecent(r.path); setRecent(getRecent()); }}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
