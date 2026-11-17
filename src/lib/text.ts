import type { FontFamily, TextItem, Rot } from "../model";
import { TEXT_PAD, LINE_HEIGHT } from "../model";

export const CSS_FONT: Record<FontFamily, string> = {
  Helvetica: "Arial, Helvetica, sans-serif",
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

let ctx: CanvasRenderingContext2D | null = null;

/** Natural (unrotated) size of a text block in points. */
export function measureText(text: string, font: FontFamily, bold: boolean, size: number): { nw: number; nh: number } {
  ctx ??= document.createElement("canvas").getContext("2d")!;
  ctx.font = `${bold ? "bold " : ""}${size}px ${CSS_FONT[font]}`;
  const lines = text.split("\n");
  const w = Math.max(size * 0.5, ...lines.map((l) => ctx!.measureText(l).width));
  return { nw: w + 2 * TEXT_PAD + 1, nh: lines.length * size * LINE_HEIGHT + 2 * TEXT_PAD };
}

/** Recompute w/h of a text item after its content or style changed (keeps top-left fixed). */
export function fitText<T extends Pick<TextItem, "text" | "font" | "bold" | "fontSize"> & { rot: Rot }>(it: T): { w: number; h: number } {
  const { nw, nh } = measureText(it.text, it.font, it.bold, it.fontSize);
  return it.rot === 90 || it.rot === 270 ? { w: nh, h: nw } : { w: nw, h: nh };
}
