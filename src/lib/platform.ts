// File access: native (Tauri) when running as the desktop app, browser fallback otherwise.
import { invoke } from "@tauri-apps/api/core";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface OpenedFile { name: string; path: string | null; bytes: Uint8Array }

export const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

export async function readPath(path: string): Promise<OpenedFile> {
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return { name: baseName(path), path, bytes: new Uint8Array(buf) };
}

async function writePath(path: string, bytes: Uint8Array) {
  await invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

function browserPick(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

export async function pickPdfs(multiple = false): Promise<OpenedFile[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!res) return [];
    const paths = Array.isArray(res) ? res : [res];
    return Promise.all(paths.map(readPath));
  }
  const files = await browserPick("application/pdf,.pdf", multiple);
  return Promise.all(files.map(async (f) => ({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export async function pickImage(): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] });
    if (!res || Array.isArray(res)) return null;
    const f = await readPath(res);
    return { bytes: f.bytes, name: f.name };
  }
  const [f] = await browserPick("image/*", false);
  return f ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : null;
}

/**
 * Save bytes. With `path`, overwrite it; otherwise ask where to save.
 * Returns where it was saved, or null if cancelled.
 */
export async function saveBytes(bytes: Uint8Array, suggestedName: string, path: string | null): Promise<{ path: string | null; name: string } | null> {
  if (isTauri) {
    let target = path;
    if (!target) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      target = await save({ defaultPath: suggestedName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!target) return null;
      if (!/\.pdf$/i.test(target)) target += ".pdf";
    }
    await writePath(target, bytes);
    return { path: target, name: baseName(target) };
  }
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { path: null, name: suggestedName };
}

export async function confirmDialog(message: string, title = "Plume PDF"): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning" });
  }
  return window.confirm(message);
}

export async function alertDialog(message: string, title = "Plume PDF"): Promise<void> {
  if (isTauri) {
    const { message: msg } = await import("@tauri-apps/plugin-dialog");
    await msg(message, { title });
    return;
  }
  window.alert(message);
}

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;

/** Open a link from a PDF in the user's default browser (or mail app), after asking. */
export async function openExternal(url: string): Promise<void> {
  if (!SAFE_LINK.test(url)) {
    await alertDialog(`This link can't be opened for safety reasons:\n\n${url.slice(0, 300)}`);
    return;
  }
  let shown = url;
  try {
    const u = new URL(url);
    if (u.protocol.startsWith("http")) shown = `${u.host}\n\n${url}`;
  } catch { /* show as-is */ }
  if (shown.length > 600) shown = shown.slice(0, 600) + "…";
  const kind = /^mailto:/i.test(url) ? "your mail app" : /^tel:/i.test(url) ? "your phone app" : "your browser";
  if (!(await confirmDialog(`Open this link in ${kind}?\n\n${shown}`, "Open link"))) return;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function getStartupFile(): Promise<string | null> {
  if (!isTauri) return null;
  return invoke<string | null>("startup_file");
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (isTauri) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().setTitle(title).catch(() => {});
  }
}

// ---------- recent files ----------

export interface Recent { path: string; name: string; time: number }
const RECENT_KEY = "plume.recent";

export function getRecent(): Recent[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
export function addRecent(path: string) {
  const list = getRecent().filter((r) => r.path !== path);
  list.unshift({ path, name: baseName(path), time: Date.now() });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* ignore */ }
}
export function removeRecent(path: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter((r) => r.path !== path))); } catch { /* ignore */ }
}
