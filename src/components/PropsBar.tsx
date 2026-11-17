import { Bold, Trash2 } from "lucide-react";
import { useStore, Style, Tool } from "../store";
import { Item, TextItem, FontFamily } from "../model";
import { fitText } from "../lib/text";

const INK = ["#000000", "#1a3c8f", "#d32f2f", "#2e7d32", "#6a1b9a"];
const HIGHLIGHT = ["#fff176", "#a5f3a1", "#ffc1dc", "#a7e3ff", "#ffcc80"];
const FILLS = ["#ffffff", "#f5f5f5", "#fffde7", "#000000"];
const NOTES = ["#ffd54f", "#a5f3a1", "#a7e3ff", "#ffc1dc"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];

const HINT: Partial<Record<Tool, string>> = {
  select: "Click fields to fill them. Click an added item to move or resize it, double-click text to edit it.",
  text: "Click anywhere on the page to type.",
  rect: "Drag over the area to hide. Tip: add a text box on top to replace text.",
  highlight: "Select text to highlight it.",
  underline: "Select text to underline it.",
  strike: "Select text to strike it through.",
  pen: "Draw freely on the page.",
  note: "Click where the note should go.",
  check: "Click to place check marks.", cross: "Click to place crosses.", dot: "Click to place dots.",
  circle: "Click to place circles.", date: "Click to stamp today's date.",
  place: "Click on the page to place it. Press Esc to cancel.",
};

function Swatches({ colors, value, onChange, custom = true }: { colors: string[]; value: string; onChange: (c: string) => void; custom?: boolean }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} className={`swatch${c.toLowerCase() === value.toLowerCase() ? " on" : ""}`} style={{ background: c }}
          title={c} aria-label={`Color ${c}`} onClick={() => onChange(c)} />
      ))}
      {custom && <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title="Custom color" />}
    </div>
  );
}

export function PropsBar() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selected = useStore((s) => s.items.find((i) => i.id === s.selectedId) ?? null);
  const doc = useStore((s) => s.doc);
  if (!doc) return null;

  const kind = selected ? selected.type : tool;
  const update = (patch: Record<string, unknown>, stylePatch: Partial<Style>) => {
    const s = useStore.getState();
    s.setStyle(stylePatch);
    if (selected) {
      let p = patch as Partial<Item>;
      if (selected.type === "text") p = { ...p, ...fitText({ ...selected, ...(patch as Partial<TextItem>) }) };
      s.updateItem(selected.id, p);
    }
  };
  const textLike = kind === "text" || kind === "date";
  const cur = <T,>(key: string, fallback: T): T =>
    selected && key in selected ? ((selected as unknown as Record<string, T>)[key]) : fallback;

  return (
    <div className="propsbar">
      {textLike && (<>
        <select value={cur("font", style.font)} onChange={(e) => update({ font: e.target.value as FontFamily }, { font: e.target.value as FontFamily })} aria-label="Font">
          <option value="Helvetica">Sans (Helvetica)</option>
          <option value="Times">Serif (Times)</option>
          <option value="Courier">Mono (Courier)</option>
        </select>
        <select value={cur("fontSize", style.fontSize)} onChange={(e) => update({ fontSize: +e.target.value }, { fontSize: +e.target.value })} aria-label="Font size">
          {[...new Set([...SIZES, cur("fontSize", style.fontSize)])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s} pt</option>)}
        </select>
        <button className={`tb-btn small${cur("bold", style.bold) ? " active" : ""}`} title="Bold"
          onClick={() => { const b = !cur("bold", style.bold); update({ bold: b }, { bold: b }); }}><Bold size={16} /></button>
        <Swatches colors={INK} value={cur("color", style.color)} onChange={(c) => update({ color: c }, { color: c })} />
      </>)}
      {(kind === "pen" || kind === "ink") && (<>
        <Swatches colors={INK} value={cur("color", style.color)} onChange={(c) => update({ color: c }, { color: c })} />
        <select value={cur("width", style.penWidth)} onChange={(e) => update({ width: +e.target.value }, { penWidth: +e.target.value })} aria-label="Pen width">
          {[1, 1.5, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} pt</option>)}
        </select>
      </>)}
      {["check", "cross", "dot", "circle", "shape"].includes(kind) && (
        <Swatches colors={INK} value={cur("color", style.color)} onChange={(c) => update({ color: c }, { color: c })} />
      )}
      {kind === "highlight" && (
        <Swatches colors={HIGHLIGHT} value={cur("color", style.highlight)} onChange={(c) => update({ color: c }, { highlight: c })} />
      )}
      {(kind === "underline" || kind === "strike") && (
        <Swatches colors={INK} value={cur("color", style.markColor)} onChange={(c) => update({ color: c }, { markColor: c })} />
      )}
      {kind === "rect" && (<>
        <span className="pb-label">Fill</span>
        <Swatches colors={FILLS} value={cur("fill", style.fill)} onChange={(c) => update({ fill: c }, { fill: c })} />
      </>)}
      {kind === "note" && (
        <Swatches colors={NOTES} value={cur("color", style.noteColor)} onChange={(c) => update({ color: c }, { noteColor: c })} custom={false} />
      )}
      {selected ? (
        <button className="tb-btn small danger" title="Delete (Del)" onClick={() => useStore.getState().deleteItem(selected.id)}><Trash2 size={16} /></button>
      ) : null}
      <span className="pb-hint">{selected ? describe(selected) : HINT[tool]}</span>
    </div>
  );
}

function describe(it: Item) {
  switch (it.type) {
    case "text": return "Text: drag to move, corner to resize, double-click (or Enter) to edit.";
    case "image": return it.signature ? "Signature: drag to move, corner to resize (Shift = free)." : "Image: drag to move, corner to resize (Shift = free).";
    case "rect": return "White-out: drag to move, corner to resize.";
    case "note": return "Note: click to edit, drag to move.";
    case "ink": return "Drawing: drag to move.";
    case "shape": return "Stamp: drag to move, corner to resize.";
    default: return "Markup: change its color or delete it.";
  }
}
