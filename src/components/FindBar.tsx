import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, ChevronDown, X, CaseSensitive, WholeWord } from "lucide-react";
import { viewer } from "../pdf/viewer";

export function FindBar({ focusKey, onClose }: { focusKey: number; onClose: () => void }) {
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const [q, setQ] = useState("");
  const [cs, setCs] = useState(false);
  const [ww, setWw] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [focusKey]);
  useEffect(() => { if (q) viewer.search(q, { caseSensitive: cs, wholeWord: ww }); else viewer.clearSearch(); }, [q, cs, ww]);

  const step = (prev: boolean) => q && viewer.search(q, { again: true, prev, caseSensitive: cs, wholeWord: ww });
  const close = () => { viewer.clearSearch(); onClose(); };
  const { current, total, notFound } = viewer.find;

  return (
    <div className="findbar" role="search">
      <input
        ref={ref}
        value={q}
        placeholder="Find in document"
        className={notFound && q ? "notfound" : ""}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "F3") { e.preventDefault(); step(e.shiftKey); }
          if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
        aria-label="Find text"
      />
      <span className="find-count">{q ? (total ? `${current} of ${total}` : notFound ? "No matches" : "…") : ""}</span>
      <button className={`tb-btn small${cs ? " active" : ""}`} title="Match case" onClick={() => setCs(!cs)}><CaseSensitive size={16} /></button>
      <button className={`tb-btn small${ww ? " active" : ""}`} title="Whole words" onClick={() => setWw(!ww)}><WholeWord size={16} /></button>
      <button className="tb-btn small" title="Previous (Shift+Enter)" onClick={() => step(true)}><ChevronUp size={16} /></button>
      <button className="tb-btn small" title="Next (Enter)" onClick={() => step(false)}><ChevronDown size={16} /></button>
      <button className="tb-btn small" title="Close (Esc)" onClick={close}><X size={16} /></button>
    </div>
  );
}
