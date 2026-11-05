// =====================================================================
// libs.js – Externe Bibliotheken bei Bedarf laden (nur Code, keine Daten).
// Texterkennung, QR und PDF-Lesen laufen komplett auf dem Gerät.
// Nach dem ersten Laden speichert der Service Worker sie für offline.
// =====================================================================
const URLS = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  jsqr: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfworker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};
const loaded = {};
function script(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Bibliothek nicht ladbar (offline?)')); };
    document.head.appendChild(s);
  }));
}
export async function tesseract() { await script(URLS.tesseract); return window.Tesseract; }
export async function jsQR() { await script(URLS.jsqr); return window.jsQR; }
export async function pdfjs() {
  await script(URLS.pdfjs);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URLS.pdfworker;
  return window.pdfjsLib;
}
