// Thin controller around PDF.js's PDFViewer: rendering, text layer, forms, search, zoom,
// plus one overlay <div> per page where our editable items are drawn (via React portals).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { EventBus, PDFLinkService, PDFFindController, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openExternal } from "../lib/platform";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageSize { w: number; h: number }
export interface FindState { current: number; total: number; notFound: boolean }

type Listener = () => void;

export class ViewerController {
  container: HTMLDivElement | null = null;
  eventBus = new EventBus();
  linkService = new PDFLinkService({ eventBus: this.eventBus });
  findController = new PDFFindController({ eventBus: this.eventBus, linkService: this.linkService, updateMatchesCountOnProgress: true });
  viewer: PDFViewer | null = null;
  doc: PDFDocumentProxy | null = null;
  overlays: HTMLDivElement[] = [];
  pageSizes: PageSize[] = [];
  scale = 1;
  pageNumber = 1;
  find: FindState = { current: 0, total: 0, notFound: false };
  formsModified = false;
  version = 0;
  /** Increments each time a document finishes loading (keys thumbnails/overlays). */
  docId = 0;
  private listeners = new Set<Listener>();
  private snapshot = { version: 0 };

  subscribe = (l: Listener) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.version++;
    this.snapshot = { version: this.version };
    this.listeners.forEach((l) => l());
  }

  attach(container: HTMLDivElement, viewerDiv: HTMLDivElement) {
    if (this.viewer) return;
    this.container = container;
    this.viewer = new PDFViewer({
      container, viewer: viewerDiv, eventBus: this.eventBus, linkService: this.linkService,
      findController: this.findController, textLayerMode: 1, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE, imageResourcesPath: "./pdfjs-images/",
      removePageBorders: false,
    });
    this.linkService.setViewer(this.viewer);
    // Links in the PDF: internal ones (#page...) are handled by PDF.js; web/mail links open
    // outside the app after confirmation, never inside the app window.
    const onLink = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !container.contains(a)) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#")) {
        if (e.type === "auxclick") e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "click" || e.button === 1) void openExternal(href);
    };
    container.addEventListener("click", onLink, true);
    container.addEventListener("auxclick", onLink, true);
    const bus = this.eventBus;
    bus.on("pagesinit", () => {
      if (!this.viewer) return;
      this.viewer.currentScaleValue = String(this.pendingScale ?? "page-width");
      if (this.pendingPage) this.viewer.currentPageNumber = Math.min(this.pendingPage, this.doc?.numPages ?? 1);
      this.pendingScale = null; this.pendingPage = null;
      this.ensureOverlays();
    });
    const re = () => this.ensureOverlays();
    bus.on("pagerendered", re);
    bus.on("textlayerrendered", re);
    bus.on("annotationlayerrendered", re);
    bus.on("scalechanging", (e: { scale: number }) => { this.scale = e.scale; this.ensureOverlays(); this.emit(); });
    bus.on("pagechanging", (e: { pageNumber: number }) => { this.pageNumber = e.pageNumber; this.emit(); });
    bus.on("updatefindmatchescount", (e: { matchesCount: { current: number; total: number } }) => {
      this.find = { ...this.find, current: e.matchesCount.current, total: e.matchesCount.total };
      this.emit();
    });
    bus.on("updatefindcontrolstate", (e: { state: number; matchesCount: { current: number; total: number } }) => {
      this.find = { current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0, notFound: e.state === 1 };
      this.emit();
    });
  }

  private loadToken = 0;
  private pendingScale: string | number | null = null;
  private pendingPage: number | null = null;

  /** Load bytes. Pass keepView to restore page/zoom (used after page operations). */
  async load(bytes: Uint8Array, opts: { keepView?: boolean; password?: () => Promise<string | null> } = {}) {
    if (!this.viewer) throw new Error("viewer not attached");
    if (opts.keepView && this.doc) {
      this.pendingScale = this.viewer.currentScaleValue || this.viewer.currentScale;
      this.pendingPage = this.viewer.currentPageNumber;
    }
    const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false, isEvalSupported: false });
    if (opts.password) {
      const ask = opts.password;
      task.onPassword = async (update: (p: string) => void, reason: number) => {
        const p = await ask();
        if (p === null) { task.destroy(); return; }
        update(p);
        void reason;
      };
    }
    const token = ++this.loadToken;
    const doc = await task.promise;
    const sizes: PageSize[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ w: vp.width, h: vp.height });
    }
    if (token !== this.loadToken) { doc.destroy(); return; }
    const old = this.doc;
    this.doc = doc;
    this.docId++;
    this.pageSizes = sizes;
    this.formsModified = false;
    doc.annotationStorage.onSetModified = () => { this.formsModified = true; this.emit(); };
    doc.annotationStorage.onResetModified = () => { this.formsModified = false; this.emit(); };
    this.overlays = sizes.map((_, i) => {
      const d = document.createElement("div");
      d.className = "plume-overlay";
      d.dataset.page = String(i);
      return d;
    });
    this.find = { current: 0, total: 0, notFound: false };
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
    this.emit();
    old?.destroy();
  }

  close() {
    this.viewer?.setDocument(null as never);
    this.linkService.setDocument(null, null);
    this.doc?.destroy();
    this.doc = null;
    this.overlays = [];
    this.pageSizes = [];
    this.emit();
  }

  ensureOverlays() {
    if (!this.viewer || !this.doc) return;
    for (let i = 0; i < this.overlays.length; i++) {
      const pv = this.viewer.getPageView(i);
      const ov = this.overlays[i];
      if (pv?.div && ov.parentElement !== pv.div) pv.div.appendChild(ov);
    }
  }

  /** Document bytes with current form values baked in (or the input bytes if forms untouched). */
  async bytesWithForms(base: Uint8Array): Promise<Uint8Array> {
    if (!this.doc || this.doc.annotationStorage.size === 0) return base;
    return this.doc.saveDocument();
  }

  markFormsSaved() { this.doc?.annotationStorage.resetModified(); }

  // ---------- navigation & zoom ----------
  setScale(v: number | string) {
    if (!this.viewer) return;
    if (typeof v === "number") this.viewer.currentScale = Math.max(0.25, Math.min(6, v));
    else this.viewer.currentScaleValue = v;
  }
  zoomBy(factor: number) { this.setScale((this.viewer?.currentScale ?? 1) * factor); }
  goToPage(n: number) { if (this.viewer && this.doc) this.viewer.currentPageNumber = Math.max(1, Math.min(this.doc.numPages, n)); }

  // ---------- search ----------
  search(query: string, o: { again?: boolean; prev?: boolean; caseSensitive?: boolean; wholeWord?: boolean }) {
    this.eventBus.dispatch("find", {
      source: this, type: o.again ? "again" : "", query, caseSensitive: !!o.caseSensitive, entireWord: !!o.wholeWord,
      highlightAll: true, findPrevious: !!o.prev, matchDiacritics: false,
    });
  }
  clearSearch() {
    this.eventBus.dispatch("findbarclose", { source: this });
    this.find = { current: 0, total: 0, notFound: false };
    this.emit();
  }
}

export const viewer = new ViewerController();
