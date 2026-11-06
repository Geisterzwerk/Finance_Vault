// =====================================================================
// libs.js – Bibliotheken bei Bedarf laden (nur Code, keine Daten).
// Texterkennung, QR und PDF-Lesen laufen komplett auf dem Gerät.
//
// SICHERHEIT: Alle Bibliotheken liegen im Repo unter /vendor (feste
// Versionen, Prüfsummen in vendor/SHA256SUMS). Es wird kein fremder Code
// von einem CDN geladen – sonst könnte ein kompromittiertes CDN im selben
// Ursprung wie deine entschlüsselten Daten laufen.
// =====================================================================
const BASE = new URL('../vendor/', import.meta.url).href;
const URLS = {
  tesseract: BASE + 'tesseract-5.1.1/tesseract.min.js',
  tessWorker: BASE + 'tesseract-5.1.1/worker.min.js',
  tessCore: BASE + 'tesseract-5.1.1/core',
  tessLang: BASE + 'tesseract-5.1.1/lang',
  jsqr: BASE + 'jsqr-1.4.0/jsQR.js',
  pdfjs: BASE + 'pdfjs-3.11.174/pdf.min.js',
  pdfworker: BASE + 'pdfjs-3.11.174/pdf.worker.min.js',
};
const loaded = {};
function script(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete loaded[src]; s.remove(); rej(new Error('Bibliothek nicht ladbar')); };
    document.head.appendChild(s);
  }));
}

export async function tesseract() { await script(URLS.tesseract); return window.Tesseract; }
// Optionen für createWorker: alles vom eigenen Ursprung, kein Blob-Worker
export const tesseractOptions = () => ({
  workerPath: URLS.tessWorker, corePath: URLS.tessCore, langPath: URLS.tessLang,
  workerBlobURL: false, gzip: true,
});

export async function jsQR() { await script(URLS.jsqr); return window.jsQR; }

export async function pdfjs() {
  await script(URLS.pdfjs);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URLS.pdfworker;
  return window.pdfjsLib;
}
