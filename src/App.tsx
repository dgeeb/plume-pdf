import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { useStore, isDirty } from "./store";
import { viewer } from "./pdf/viewer";
import { Toolbar, Theme } from "./components/Toolbar";
import { PropsBar } from "./components/PropsBar";
import { Sidebar } from "./components/Sidebar";
import { FindBar } from "./components/FindBar";
import { Overlays, finishEdit } from "./components/Overlays";
import { SignatureDialog } from "./components/SignatureDialog";
import { HelpDialog, PasswordDialog, Welcome } from "./components/Dialogs";
import { useMarkupFromSelection, useShortcuts } from "./hooks";
import { openFiles, openPath, dirty } from "./actions";
import { isTauri, getStartupFile, setWindowTitle, confirmDialog } from "./lib/platform";

const THEME_KEY = "plume.theme";

export default function App() {
  const doc = useStore((s) => s.doc);
  const loadId = useStore((s) => s.loadId);
  const sidebar = useStore((s) => s.sidebar);
  const tool = useStore((s) => s.tool);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const findOpen = useStore((s) => s.findOpen);
  const set = useStore((s) => s.set);
  const container = useRef<HTMLDivElement>(null);
  const viewerDiv = useRef<HTMLDivElement>(null);
  const [findKey, setFindKey] = useState(0);
  const [sigOpen, setSigOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pwAsk, setPwAsk] = useState<((p: string | null) => void) | null>(null);
  const [dropping, setDropping] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem(THEME_KEY) as Theme) || "system"; } catch { return "system"; }
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Mount PDF.js once.
  useEffect(() => {
    if (container.current && viewerDiv.current) viewer.attach(container.current, viewerDiv.current);
  }, []);

  // (Re)load the viewer when the document bytes change.
  useEffect(() => {
    const s = useStore.getState();
    if (!s.doc) return;
    const askPassword = () => new Promise<string | null>((resolve) => setPwAsk(() => (p: string | null) => { setPwAsk(null); resolve(p); }));
    viewer.load(s.doc.bytes, { keepView: s.keepView, password: askPassword }).catch((e) => {
      console.error(e);
      s.notify("Could not display this PDF: " + (e?.message ?? e));
      if (!s.keepView) s.closeDoc();
    });
  }, [loadId]);

  // Window title with unsaved marker.
  useSyncExternalStore(viewer.subscribe, viewer.getSnapshot);
  const items = useStore((s) => s.items);
  const saved = useStore((s) => s.saved);
  const isDirtyNow = isDirty({ doc, items, saved }, viewer.formsModified);
  useEffect(() => {
    setWindowTitle(doc ? `${isDirtyNow ? "• " : ""}${doc.name} — Plume PDF` : "Plume PDF");
  }, [doc, isDirtyNow]);

  // Open a file passed on the command line (double-click in Explorer).
  useEffect(() => {
    getStartupFile().then((p) => { if (p) openPath(p); }).catch(() => {});
  }, []);

  // Drag & drop files onto the window.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(async (e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDropping(true);
        else if (e.payload.type === "leave") setDropping(false);
        else if (e.payload.type === "drop") {
          setDropping(false);
          const pdfs = e.payload.paths.filter((p) => /\.pdf$/i.test(p));
          if (!pdfs.length) return;
          const { readPath } = await import("./lib/platform");
          openFiles(await Promise.all(pdfs.map(readPath)));
        }
      }).then((u) => { unlisten = u; }),
    );
    return () => unlisten?.();
  }, []);

  // Confirm before closing with unsaved changes.
  useEffect(() => {
    if (isTauri) {
      let unlisten: (() => void) | undefined;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (e) => {
          if (dirty() && !(await confirmDialog("You have unsaved changes. Close without saving?"))) e.preventDefault();
        }).then((u) => { unlisten = u; }),
      );
      return () => unlisten?.();
    }
    const h = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // Ctrl + mouse wheel zoom.
  useEffect(() => {
    const el = container.current!;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      viewer.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const openFind = useCallback(() => { set({ findOpen: true }); setFindKey((k) => k + 1); }, [set]);
  const handlers = useMemo(() => ({
    openFind,
    openSignature: () => setSigOpen(true),
    openHelp: () => setHelpOpen(true),
  }), [openFind]);
  useShortcuts(handlers);
  useMarkupFromSelection();

  const onBrowserDrop = async (e: React.DragEvent) => {
    if (isTauri) return;
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) return;
    openFiles(await Promise.all(files.map(async (f) => ({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  };

  return (
    <div
      className="app"
      onDragOver={(e) => { if (!isTauri && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={onBrowserDrop}
    >
      <Toolbar theme={theme} setTheme={setTheme} onFind={openFind} onSignature={() => setSigOpen(true)} onHelp={() => setHelpOpen(true)} />
      <PropsBar />
      <div className="main">
        {doc && sidebar && <Sidebar />}
        <div className="viewer-wrap">
          <div
            ref={container}
            className={`viewer-container tool-${tool}`}
            style={{ visibility: doc ? "visible" : "hidden" }}
            onPointerDown={(e) => {
              const t = e.target as HTMLElement;
              if (!t.closest(".pl-item, .pl-note, .pl-notepop, .pl-mark, .pl-inkitem, .pl-handle")) {
                if (useStore.getState().editingId) finishEdit();
                if (useStore.getState().selectedId) set({ selectedId: null });
              }
            }}
          >
            <div ref={viewerDiv} className="pdfViewer" />
          </div>
          {doc && findOpen && <FindBar focusKey={findKey} onClose={() => set({ findOpen: false })} />}
          {!doc && <Welcome />}
        </div>
      </div>
      <Overlays />
      {sigOpen && <SignatureDialog onClose={() => setSigOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {pwAsk && <PasswordDialog onDone={pwAsk} />}
      {dropping && <div className="drop-hint">Drop PDF to open</div>}
      {busy && <div className="busy"><Loader2 className="spin" size={18} /> {busy}…</div>}
      {toast && <div className="toast" onClick={() => set({ toast: null })}>{toast}</div>}
    </div>
  );
}
