import { useEffect, useRef, useState } from "react";
import { X, Trash2, Upload } from "lucide-react";
import "@fontsource/dancing-script/400.css";
import "@fontsource/caveat/400.css";
import { useStore } from "../store";
import { bytesToCanvas, getSignatures, setSignatures, removeWhite, trim, SavedSig } from "../lib/image";
import { uid } from "../model";
import { pickImage } from "../lib/platform";

type Tab = "saved" | "draw" | "type" | "upload";
const INKS = ["#111111", "#1a3c8f"];
const FONTS = [{ name: "Dancing Script", label: "Elegant" }, { name: "Caveat", label: "Handwritten" }];

function place(sig: { src: string; w: number; h: number }) {
  const targetH = 36; // points
  let w = (targetH * sig.w) / sig.h, h = targetH;
  if (w > 220) { h = (220 * h) / w; w = 220; }
  useStore.getState().set({ placement: { src: sig.src, w, h, signature: true }, tool: "place", selectedId: null });
}

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState<SavedSig[]>(getSignatures);
  const [tab, setTab] = useState<Tab>(saved.length ? "saved" : "draw");
  const [ink, setInk] = useState(INKS[0]);
  const [keep, setKeep] = useState(true);
  const [name, setName] = useState("");
  const [font, setFont] = useState(FONTS[0].name);
  const [upload, setUpload] = useState<HTMLCanvasElement | null>(null);
  const [whiteBg, setWhiteBg] = useState(true);
  const draw = useRef<HTMLCanvasElement>(null);
  const typed = useRef<HTMLCanvasElement>(null);
  const uploadPreview = useRef<HTMLCanvasElement>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // ----- draw tab -----
  useEffect(() => {
    if (tab !== "draw") return;
    const c = draw.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
    setHasInk(false);
  }, [tab]);

  const onDrawDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    ctx.strokeStyle = ink; ctx.lineWidth = 2.6 * sx; ctx.lineCap = "round"; ctx.lineJoin = "round";
    let last = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx };
    let mid = last;
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + 0.1, last.y); ctx.stroke();
    const move = (ev: PointerEvent) => {
      const p = { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sx };
      const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(last.x, last.y, m.x, m.y); ctx.stroke();
      last = p; mid = m;
    };
    const up = () => { c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); setHasInk(true); };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  };

  // ----- type tab -----
  useEffect(() => {
    if (tab !== "type") return;
    let alive = true;
    (async () => {
      await document.fonts.load(`64px "${font}"`);
      const c = typed.current;
      if (!alive || !c) return;
      const ctx = c.getContext("2d")!;
      const size = 72;
      ctx.font = `${size}px "${font}"`;
      const w = Math.max(10, ctx.measureText(name || " ").width + 40);
      c.width = w; c.height = size * 1.6;
      ctx.font = `${size}px "${font}"`;
      ctx.fillStyle = ink;
      ctx.textBaseline = "middle";
      ctx.fillText(name, 20, c.height / 2);
    })();
    return () => { alive = false; };
  }, [tab, name, font, ink]);

  // ----- upload tab -----
  useEffect(() => {
    if (tab !== "upload" || !upload || !uploadPreview.current) return;
    const c = uploadPreview.current;
    c.width = upload.width; c.height = upload.height;
    c.getContext("2d")!.drawImage(upload, 0, 0);
    if (whiteBg) removeWhite(c);
  }, [tab, upload, whiteBg]);

  const chooseUpload = async () => {
    const f = await pickImage();
    if (f) setUpload(await bytesToCanvas(f.bytes));
  };

  const finish = (src: HTMLCanvasElement | null) => {
    const t = src && trim(src);
    if (!t) return;
    // Keep signatures reasonably small.
    const maxW = 900;
    let out = t;
    if (t.width > maxW) {
      out = document.createElement("canvas");
      out.width = maxW; out.height = Math.round((t.height * maxW) / t.width);
      out.getContext("2d")!.drawImage(t, 0, 0, out.width, out.height);
    }
    const sig: SavedSig = { id: uid(), src: out.toDataURL("image/png"), w: out.width, h: out.height };
    if (keep) setSignatures([sig, ...saved]);
    place(sig);
    onClose();
  };

  const canUse = tab === "draw" ? hasInk : tab === "type" ? !!name.trim() : tab === "upload" ? !!upload : false;

  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sig-modal" role="dialog" aria-label="Signature">
        <div className="modal-head">
          <h2>Signature</h2>
          <button className="tb-btn small" onClick={onClose} title="Close"><X size={16} /></button>
        </div>
        <div className="tabs">
          {saved.length > 0 && <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>My signatures</button>}
          <button className={tab === "draw" ? "on" : ""} onClick={() => setTab("draw")}>Draw</button>
          <button className={tab === "type" ? "on" : ""} onClick={() => setTab("type")}>Type</button>
          <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>Image</button>
        </div>

        {tab === "saved" && (
          <div className="sig-grid">
            {saved.map((s) => (
              <div key={s.id} className="sig-card">
                <button className="sig-use" onClick={() => { place(s); onClose(); }} title="Place this signature">
                  <img src={s.src} alt="Saved signature" />
                </button>
                <button className="sig-del" title="Remove" onClick={() => { const l = saved.filter((x) => x.id !== s.id); setSaved(l); setSignatures(l); if (!l.length) setTab("draw"); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "draw" && (
          <div className="sig-pad-wrap">
            <canvas ref={draw} className="sig-pad" onPointerDown={onDrawDown} />
            <div className="sig-line">Sign above the line</div>
            <button className="link" onClick={() => { const c = draw.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHasInk(false); }}>Clear</button>
          </div>
        )}

        {tab === "type" && (
          <div className="sig-type">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" />
            <div className="sig-fonts">
              {FONTS.map((f) => (
                <button key={f.name} className={font === f.name ? "on" : ""} onClick={() => setFont(f.name)} style={{ fontFamily: f.name }}>
                  {name || f.label}
                </button>
              ))}
            </div>
            <canvas ref={typed} className="sig-typed" />
          </div>
        )}

        {tab === "upload" && (
          <div className="sig-upload">
            {upload ? <canvas ref={uploadPreview} className="sig-typed checker" /> : <p>Use a photo or scan of your signature.</p>}
            <div className="row">
              <button className="btn" onClick={chooseUpload}><Upload size={14} /> Choose image…</button>
              <label><input type="checkbox" checked={whiteBg} onChange={(e) => setWhiteBg(e.target.checked)} /> Remove white background</label>
            </div>
          </div>
        )}

        {tab !== "saved" && (
          <div className="modal-foot">
            {tab !== "upload" && (
              <div className="swatches">
                {INKS.map((c) => <button key={c} className={`swatch${c === ink ? " on" : ""}`} style={{ background: c }} onClick={() => setInk(c)} aria-label={`Ink ${c}`} />)}
              </div>
            )}
            <label className="keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Save for next time</label>
            <div className="tb-spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!canUse}
              onClick={() => finish(tab === "draw" ? draw.current : tab === "type" ? typed.current : uploadPreview.current)}>
              Place on page
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
