// =====================================================================
// scan.js – Dokument-Scanner
// Foto -> Ecken erkennen (anpassbar) -> Perspektive korrigieren ->
// Kontrast verbessern -> PDF erstellen -> QR-Rechnung + Text erkennen ->
// Kategorie und Steuerrelevanz vorschlagen.
// =====================================================================
import * as LIB from './libs.js';

// ---------- Bild laden ----------
export function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => rej(new Error('Bild nicht lesbar'));
    img.src = url;
  });
}
export function toCanvas(img, maxSide = 2200) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ---------- Ecken automatisch schätzen (helles Papier auf dunklerem Grund) ----------
export function detectCorners(canvas) {
  const W = canvas.width, H = canvas.height;
  const k = 320 / Math.max(W, H);
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h); const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) { const v = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0; g[i] = v; hist[v]++; }
  // Otsu-Schwelle
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = w * h - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  let n = 0; let tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
  const m = 2; // Rand ignorieren
  for (let yy = m; yy < h - m; yy++) for (let xx = m; xx < w - m; xx++) {
    if (g[yy * w + xx] <= thr) continue; n++;
    const s = xx + yy, df = xx - yy;
    if (s < tl[2]) tl = [xx, yy, s]; if (s > br[2]) br = [xx, yy, s];
    if (df > tr[2]) tr = [xx, yy, df]; if (df < bl[2]) bl = [xx, yy, df];
  }
  const frac = n / (w * h);
  if (frac < 0.12 || frac > 0.93) return full(W, H);
  const pts = [tl, tr, br, bl].map(([px, py]) => [px / k, py / k]);
  const area = Math.abs(polyArea(pts));
  return area < W * H * 0.12 ? full(W, H) : pts;
}
const full = (W, H) => [[W * 0.04, H * 0.04], [W * 0.96, H * 0.04], [W * 0.96, H * 0.96], [W * 0.04, H * 0.96]];
function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

// ---------- Perspektive korrigieren ----------
function homography(src, dst) { // dst -> src
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gauss-Elimination
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue; const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]).concat(1);
}
export function warp(canvas, q, maxSide = 1700) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
  const H = homography(q, [[0, 0], [w, 0], [w, h], [0, h]]);
  const sw = canvas.width, sh = canvas.height;
  const sd = canvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d'); const od = ctx.createImageData(w, h); const o = od.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = H[6] * x + H[7] * y + 1;
    const u = (H[0] * x + H[1] * y + H[2]) / z, v = (H[3] * x + H[4] * y + H[5]) / z;
    const ui = Math.min(sw - 1, Math.max(0, u | 0)), vi = Math.min(sh - 1, Math.max(0, v | 0));
    const si = (vi * sw + ui) * 4, di = (y * w + x) * 4;
    o[di] = sd[si]; o[di + 1] = sd[si + 1]; o[di + 2] = sd[si + 2]; o[di + 3] = 255;
  }
  ctx.putImageData(od, 0, 0);
  return out;
}

// ---------- Kontrast (Dokument-Modus) ----------
export function enhance(canvas, mode = 'gray') {
  if (mode === 'color') return canvas;
  const ctx = canvas.getContext('2d'); const im = ctx.getImageData(0, 0, canvas.width, canvas.height); const d = im.data;
  const hist = new Array(256).fill(0); const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.02) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.05) { hi = i; break; } }
  const span = Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let v = ((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) - lo) * 255 / span;
    if (mode === 'bw') v = v > 150 ? 255 : v < 90 ? 0 : (v - 90) * 4.25;
    v = Math.max(0, Math.min(255, v)); d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return canvas;
}

// ---------- PDF aus JPEG-Seiten (ohne Bibliothek) ----------
export async function canvasesToPDF(canvases, quality = 0.82) {
  const enc = new TextEncoder(); const parts = []; const offsets = []; let len = 0;
  const add = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
  const pages = [];
  for (const c of canvases) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    pages.push({ w: c.width, h: c.height, jpg: new Uint8Array(await blob.arrayBuffer()) });
  }
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const N = pages.length; const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add(`<< /Type /Pages /Kids [${kids}] /Count ${N} >>`));
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, im = pn + 1, cn = pn + 2;
    const PW = 595.28, PH = 841.89, m = 18; const s = Math.min((PW - 2 * m) / p.w, (PH - 2 * m) / p.h);
    const dw = p.w * s, dh = p.h * s, dx = (PW - dw) / 2, dy = (PH - dh) / 2;
    obj(pn, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${cn} 0 R >>`));
    obj(im, () => { add(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`); add(p.jpg); add('\nendstream'); });
    const cs = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im${i} Do Q`;
    obj(cn, () => add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
  });
  const total = 3 + N * 3; const xref = len;
  add(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---------- QR-Rechnung (Swiss QR-Bill) ----------
export async function readQR(canvas) {
  try {
    const jsQR = await LIB.jsQR();
    const tries = [canvas];
    if (Math.max(canvas.width, canvas.height) > 1400) { const c = document.createElement('canvas'); const k = 1400 / Math.max(canvas.width, canvas.height); c.width = canvas.width * k; c.height = canvas.height * k; c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); tries.push(c); }
    for (const c of tries) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const r = jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (r && r.data) return r.data;
    }
  } catch (e) { /* offline */ }
  return null;
}
export function parseSwissQR(txt) {
  if (!txt || !txt.startsWith('SPC')) return null;
  const L = txt.split(/\r?\n/);
  const amount = parseFloat(L[18]);
  return {
    iban: L[3] || '', creditor: L[5] || '', town: [L[8], L[9]].filter(Boolean).join(' '),
    amount: Number.isFinite(amount) ? amount : null, currency: L[19] || 'CHF',
    reference: L[28] || '', message: L[29] || '', billInfo: L[31] || '',
  };
}

// ---------- Texterkennung ----------
export async function ocr(canvas, onProgress = () => {}) {
  const T = await LIB.tesseract();
  const worker = await T.createWorker('deu', 1, { logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); } });
  try { const { data } = await worker.recognize(canvas); return data.text || ''; } finally { await worker.terminate(); }
}

// ---------- Felder aus Text ----------
const toNum = (s) => { const n = parseFloat(String(s).replace(/[’'\s]/g, '').replace(/,(\d{2})$/, '.$1')); return Number.isFinite(n) ? n : null; };
const toISO = (d, m, y) => { y = +y < 100 ? 2000 + +y : +y; const dt = new Date(y, +m - 1, +d); return isNaN(dt) || +m > 12 || +d > 31 ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
export function extractFields(text) {
  const t = text || ''; const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const f = {};
  // Betrag
  const cand = [];
  for (const l of lines) {
    const re = /(?:CHF|Fr\.?|SFr\.?)?\s*(\d{1,3}(?:['’ ]?\d{3})*[.,]\d{2})\b/g; let m;
    while ((m = re.exec(l))) {
      const v = toNum(m[1]); if (v == null || v <= 0) continue;
      const w = (/total|zu bezahlen|rechnungsbetrag|betrag|zahlbar|saldo|endbetrag/i.test(l) ? 3 : 0) + (/chf|fr\./i.test(l) ? 1 : 0);
      cand.push({ v, w });
    }
  }
  if (cand.length) { cand.sort((a, b) => b.w - a.w || b.v - a.v); f.amount = cand[0].v; }
  // Daten
  const dateRe = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g; const all = []; let m;
  while ((m = dateRe.exec(t))) { const iso = toISO(m[1], m[2], m[3]); if (iso) all.push(iso); }
  for (const l of lines) {
    if (/zahlbar|fällig|faellig|zahlungsfrist|bis zum|spätestens|valuta/i.test(l)) { const mm = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(l); if (mm) { f.due = toISO(mm[1], mm[2], mm[3]); break; } }
  }
  if (all.length) f.date = all[0];
  if (!f.due && f.date) { const dd = /(\d{1,3})\s*tag/i.exec(t); if (dd && /zahlbar|innert|innerhalb/i.test(t)) { const x = new Date(f.date); x.setDate(x.getDate() + +dd[1]); f.due = x.toISOString().slice(0, 10); } }
  const nr = /(rechnungs?[\s-]*(?:nr|nummer)|rechnung\s*nr|beleg[\s-]*nr|referenz)[.:\s#]*([A-Z0-9][A-Z0-9\-\/.]{3,})/i.exec(t);
  if (nr) f.number = nr[2];
  const issuer = lines.find((l) => /[A-Za-zÄÖÜäöü]{3,}/.test(l) && l.length < 60 && !/rechnung|seite|datum|herr|frau/i.test(l));
  if (issuer) f.issuer = issuer.replace(/[|_]+/g, '').trim();
  return f;
}

// ---------- Kategorie und Steuerrelevanz (E-Tax BL Ziffern) ----------
const RULES = [
  [/lohnausweis|salary statement/i, { kind: 'doc', category: 'Einkommen', tax: 'yes', ziffer: '100', title: 'Lohnausweis' }],
  [/3a|säule|saeule|vorsorge(konto|stiftung)|steuerbescheinigung.*vorsorge/i, { kind: 'doc', category: 'Vorsorge', tax: 'yes', ziffer: '610', title: 'Säule 3a Bescheinigung' }],
  [/steuerauszug|vermögensausweis|zinsausweis|saldo per 31|e-steuerauszug|wertschriftenverzeichnis/i, { kind: 'doc', category: 'Vermögen', tax: 'yes', ziffer: '800', title: 'Steuerauszug' }],
  [/steuerverwaltung|staatssteuer|gemeindesteuer|bundessteuer|steuerrechnung|provisorische rechnung|veranlagung/i, { kind: 'invoice', category: 'Steuern', tax: 'no', ziffer: '' }],
  [/teko|weiterbildung|semester|kursgeld|schulgeld|studiengebühr|lehrgang|prüfungsgebühr/i, { kind: 'invoice', category: 'Studium', tax: 'maybe', ziffer: '650' }],
  [/zahnarzt|arzt|praxis|spital|klinik|apotheke|physio|optiker|dental|ärztliche/i, { kind: 'invoice', category: 'Gesundheit', tax: 'maybe', ziffer: '720' }],
  [/spende|stiftung|zuwendung|hilfswerk|gemeinnützig/i, { kind: 'doc', category: 'Spenden', tax: 'maybe', ziffer: '738', title: 'Spendenbestätigung' }],
  [/\bsbb\b|tnw|u-abo|generalabonnement|halbtax|abonnement.*(öv|verkehr)|verkehrsverbund/i, { kind: 'invoice', category: 'Mobilität', tax: 'maybe', ziffer: '500' }],
  [/krankenkasse|krankenversicherung|prämie|praemie|kvg/i, { kind: 'invoice', category: 'Versicherung', tax: 'no', ziffer: '' }],
  [/swisscom|sunrise|salt|serafe|mobile|internet/i, { kind: 'invoice', category: 'Kommunikation', tax: 'no', ziffer: '' }],
  [/miete|mietzins|nebenkosten|verwaltung.*liegenschaft/i, { kind: 'invoice', category: 'Wohnen', tax: 'no', ziffer: '' }],
];
export function classify(text, qr) {
  const t = (text || '') + ' ' + (qr ? `${qr.creditor} ${qr.message} ${qr.billInfo}` : '');
  for (const [re, r] of RULES) if (re.test(t)) {
    const o = { ...r };
    if (o.category === 'Steuern') o.taxKind = /bund/i.test(t) ? 'Bund' : /gemeinde/i.test(t) ? 'Gemeinde' : 'Staat BL';
    return o;
  }
  return { kind: qr ? 'invoice' : 'doc', category: 'Sonstiges', tax: 'no', ziffer: '' };
}
export function guessTaxYear(text) {
  const m = /steuer(?:jahr|periode)?\s*(20\d{2})/i.exec(text || '') || /(?:per|bis)\s*31\.\s?12\.\s?(20\d{2})/i.exec(text || '');
  return m ? +m[1] : null;
}
