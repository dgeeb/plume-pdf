// Image helpers: normalise any image to a PNG/JPEG data URL that pdf-lib can embed.

const MAX_DIM = 2000;

function isJpeg(b: Uint8Array) { return b[0] === 0xff && b[1] === 0xd8; }

export async function bytesToCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

function hasAlpha(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

export async function imageToDataUrl(bytes: Uint8Array): Promise<{ src: string; w: number; h: number }> {
  const c = await bytesToCanvas(bytes);
  const src = isJpeg(bytes) || !hasAlpha(c) ? c.toDataURL("image/jpeg", 0.9) : c.toDataURL("image/png");
  return { src, w: c.width, h: c.height };
}

/** Make near-white pixels transparent (for photographed/scanned signatures). */
export function removeWhite(c: HTMLCanvasElement, threshold = 200) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= threshold) d[i + 3] = 0;
    else if (lum > threshold - 60) d[i + 3] = Math.round(d[i + 3] * (threshold - lum) / 60);
  }
  ctx.putImageData(img, 0, 0);
}

/** Crop away fully transparent margins; returns a new canvas (or null if empty). */
export function trim(c: HTMLCanvasElement, pad = 4): HTMLCanvasElement | null {
  const ctx = c.getContext("2d")!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// ---------- saved signatures ----------

export interface SavedSig { id: string; src: string; w: number; h: number; initials?: boolean }
const SIG_KEY = "plume.signatures";

export function getSignatures(): SavedSig[] {
  try { return JSON.parse(localStorage.getItem(SIG_KEY) || "[]"); } catch { return []; }
}
export function setSignatures(list: SavedSig[]) {
  try { localStorage.setItem(SIG_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* quota */ }
}
