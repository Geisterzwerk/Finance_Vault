// =====================================================================
// scan.js – Dokument-Scanner
// Foto -> Dokument automatisch finden (Kanten + Hough-Linien, funktioniert
// auch bei hellem Papier auf hellem Grund) -> Perspektive korrigieren ->
// Kontrast verbessern -> PDF -> QR-Rechnung + Text erkennen ->
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
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// =====================================================================
// Automatische Dokumenterkennung
// 1. verkleinern, Graustufen, weichzeichnen
// 2. Kanten (Sobel) mit adaptiver Schwelle -> auch schwache Kanten (weiss auf weiss)
// 3. Hough-Transformation -> dominante Linien
// 4. beste Kombination aus 2 waagrechten + 2 senkrechten Linien suchen,
//    bewertet nach Kantenunterstützung entlang der 4 Seiten
// Rückgabe: { corners, confidence } oder null
// =====================================================================
export function detectDocument(canvas) {
  const W = canvas.width, H = canvas.height;
  const k = 420 / Math.max(W, H);
  const w = Math.max(16, Math.round(W * k)), h = Math.max(16, Math.round(H * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  // Graustufen + Farbsättigung (hilft bei getöntem Hintergrund)
  let g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    g[i] = 0.299 * r + 0.587 * gg + 0.114 * b - 0.35 * (mx - mn);
  }
  g = blur(blur(g, w, h), w, h);
  // Sobel
  const mag = new Float32Array(w * h), ang = new Float32Array(w * h);
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const i = yy * w + xx;
    const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
    const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
    mag[i] = Math.hypot(gx, gy); ang[i] = Math.atan2(gy, gx);
  }
  // adaptive Schwelle: oberste ~7 % der Kanten
  const sorted = Array.from(mag).filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const median = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const thr = Math.max(6, sorted[Math.floor(sorted.length * 0.93)] || 0, median * 3.2);
  // Hough
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = diag * 2 + 1;
  const cosT = new Float32Array(NT), sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cosT[t] = Math.cos((t * Math.PI) / NT); sinT[t] = Math.sin((t * Math.PI) / NT); }
  const acc = new Float32Array(NT * NR);
  const border = 3;
  for (let yy = border; yy < h - border; yy++) for (let xx = border; xx < w - border; xx++) {
    const i = yy * w + xx; const m = mag[i]; if (m < thr) continue;
    let t0 = Math.round(((ang[i] + Math.PI) % Math.PI) / Math.PI * NT) % NT; // Normale = Gradientrichtung
    const wgt = Math.min(3, m / thr);
    for (let dt = -6; dt <= 6; dt++) {
      const t = (t0 + dt + NT) % NT;
      const r = Math.round(xx * cosT[t] + yy * sinT[t]) + diag;
      acc[t * NR + r] += wgt;
    }
  }
  // Peaks (lokale Maxima)
  const peaks = [];
  for (let t = 0; t < NT; t++) for (let r = 2; r < NR - 2; r++) {
    const v = acc[t * NR + r]; if (v < 8) continue;
    let isMax = true;
    for (let dt = -3; dt <= 3 && isMax; dt++) for (let dr = -4; dr <= 4; dr++) {
      if (!dt && !dr) continue;
      const tt = t + dt, rr = r + dr;
      if (tt < 0 || tt >= NT || rr < 0 || rr >= NR) continue;
      if (acc[tt * NR + rr] > v) { isMax = false; break; }
    }
    if (isMax) peaks.push({ t, r: r - diag, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const horiz = [], vert = [];
  for (const p of peaks) {
    const deg = (p.t * 180) / NT;
    if (deg > 55 && deg < 125) { if (horiz.length < 10) horiz.push(p); }
    else if (deg < 35 || deg > 145) { if (vert.length < 10) vert.push(p); }
    if (horiz.length >= 10 && vert.length >= 10) break;
  }
  if (horiz.length < 2 || vert.length < 2) return null;
  const line = (p) => ({ c: cosT[p.t], s: sinT[p.t], r: p.r });
  const inter = (a, b) => {
    const det = a.c * b.s - a.s * b.c; if (Math.abs(det) < 1e-6) return null;
    return [(a.r * b.s - b.r * a.s) / det, (a.c * b.r - b.c * a.r) / det];
  };
  // Kantenunterstützung entlang einer Strecke: starke Kante, Richtung passt
  // zur Seite, und Helligkeitswechsel immer in dieselbe Richtung (innen/aussen)
  const support = (p, q, cxm, cym) => {
    const n = 48; let hit = 0, inward = 0;
    const ex = q[0] - p[0], ey = q[1] - p[1]; const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len, ny = ex / len;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    if ((cxm - mx) * nx + (cym - my) * ny < 0) { nx = -nx; ny = -ny; } // Normale zeigt nach innen
    for (let s = 0; s < n; s++) {
      const f = (s + 0.5) / n; const cx = p[0] + ex * f, cy = p[1] + ey * f;
      let best = 0, bi = -1;
      for (let o = -2; o <= 2; o++) {
        const px = Math.round(cx + nx * o), py = Math.round(cy + ny * o);
        if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) continue;
        const i = py * w + px; if (mag[i] > best) { best = mag[i]; bi = i; }
      }
      if (bi < 0 || best < thr * 0.55) continue;
      const gx = Math.cos(ang[bi]), gy = Math.sin(ang[bi]);
      const dot = gx * nx + gy * ny;
      if (Math.abs(dot) < 0.9) continue; // Gradient senkrecht zur Seite (±25°)
      hit++; if (dot > 0) inward++;
    }
    return { s: hit / n, pol: hit ? inward / hit : 0.5 };
  };
  let best = null;
  for (let a = 0; a < horiz.length; a++) for (let b = a + 1; b < horiz.length; b++) {
    const h1 = line(horiz[a]), h2 = line(horiz[b]);
    const top = horiz[a].r * sinT[horiz[a].t] < horiz[b].r * sinT[horiz[b].t] ? [h1, h2] : [h2, h1];
    for (let c1 = 0; c1 < vert.length; c1++) for (let c2 = c1 + 1; c2 < vert.length; c2++) {
      const v1 = line(vert[c1]), v2 = line(vert[c2]);
      const p1 = inter(top[0], v1), p2 = inter(top[0], v2), p3 = inter(top[1], v2), p4 = inter(top[1], v1);
      if (!p1 || !p2 || !p3 || !p4) continue;
      let q = orderCorners([p1, p2, p3, p4]);
      const m = 0.06 * Math.max(w, h);
      if (q.some(([px, py]) => px < -m || py < -m || px > w + m || py > h + m)) continue;
      const area = Math.abs(polyArea(q));
      if (area < w * h * 0.15 || !convex(q)) continue;
      const cxm = q.reduce((a2, p) => a2 + p[0], 0) / 4, cym = q.reduce((a2, p) => a2 + p[1], 0) / 4;
      const sup = [support(q[0], q[1], cxm, cym), support(q[1], q[2], cxm, cym), support(q[2], q[3], cxm, cym), support(q[3], q[0], cxm, cym)];
      // alle Seiten gleiche Polarität (Dokument heller ODER dunkler als Hintergrund)
      const pols = sup.map((v) => v.pol);
      if (!(pols.every((v) => v >= 0.75) || pols.every((v) => v <= 0.25))) continue;
      const sides = sup.map((v) => v.s);
      const minS = Math.min(...sides), avg = sides.reduce((s2, v) => s2 + v, 0) / 4;
      const score = avg * 0.7 + minS * 0.3 + Math.min(0.15, (area / (w * h)) * 0.15);
      if (!best || score > best.score) best = { score, q, minS, avg };
    }
  }
  if (!best || best.avg < 0.42 || best.minS < 0.18) return null;
  const corners = best.q.map(([px, py]) => [Math.max(0, Math.min(W, px / k)), Math.max(0, Math.min(H, py / k))]);
  // sure = eindeutig erkannt; sonst nur Vorschlag (bitte prüfen)
  return { corners, confidence: Math.min(1, best.score), sure: best.score >= 0.75 && best.minS >= 0.45 };
}

// Rückwärtskompatibel: Array oder null
export function detectCorners(canvas) { const r = detectDocument(canvas); return r ? r.corners : null; }
export function insetCorners(W, H, f = 0.03) { return [[W * f, H * f], [W * (1 - f), H * f], [W * (1 - f), H * (1 - f)], [W * f, H * (1 - f)]]; }

function blur(src, w, h) {
  const out = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const a = x > 0 ? src[i - 1] : src[i], b = x < w - 1 ? src[i + 1] : src[i];
    tmp[i] = (a + 2 * src[i] + b) / 4;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const a = y > 0 ? tmp[i - w] : tmp[i], b = y < h - 1 ? tmp[i + w] : tmp[i];
    out[i] = (a + 2 * tmp[i] + b) / 4;
  }
  return out;
}
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const o = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // Start bei oben-links (kleinste x+y)
  let s = 0; o.forEach((p, i) => { if (p[0] + p[1] < o[s][0] + o[s][1]) s = i; });
  return [...o.slice(s), ...o.slice(0, s)];
}
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}
export function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

// ---------- Perspektive korrigieren ----------
function homography(src, dst) { // dst -> src
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
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
  q = orderCorners(q);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
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
// Weissabgleich mit lokalem Papierhintergrund: entfernt Schatten und
// ungleichmässiges Licht, Papier wird weiss, Schrift bleibt dunkel.
export function enhance(canvas, mode = 'gray') {
  if (mode === 'color') return canvas;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d'); const im = ctx.getImageData(0, 0, W, H); const d = im.data;
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 4, p++) gray[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  // Hintergrund pro Zelle: 90%-Wert (Papier), dann glätten
  const cell = Math.max(16, Math.round(Math.max(W, H) / 40));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  let bg = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    hist.fill(0); let n = 0;
    for (let y = gy * cell; y < Math.min(H, (gy + 1) * cell); y += 2) for (let x = gx * cell; x < Math.min(W, (gx + 1) * cell); x += 2) { hist[gray[y * W + x] | 0]++; n++; }
    let acc = 0, v = 255; for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= n * 0.1) { v = k; break; } }
    bg[gy * gw + gx] = Math.max(40, v);
  }
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue; s += bg[yy * gw + xx]; c++; }
      nb[y * gw + x] = Math.max(bg[y * gw + x] * 0.9, s / c);
    }
    bg = nb;
  }
  const at = (x, y) => { // bilinear
    const fx = Math.min(gw - 1.001, Math.max(0, x / cell - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, y / cell - 0.5));
    const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    return (bg[y0 * gw + x0] * (1 - ax) + bg[y0 * gw + x1] * ax) * (1 - ay) + (bg[y1 * gw + x0] * (1 - ax) + bg[y1 * gw + x1] * ax) * ay;
  };
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
    let v = gray[p] / at(x, y); // 1 = Papier
    if (mode === 'bw') v = v > 0.78 ? 255 : v < 0.55 ? 0 : ((v - 0.55) / 0.23) * 255;
    else { v = Math.min(1, v * 1.04); v = v > 0.9 ? 255 : Math.pow(Math.max(0, v), 1.6) * 255 / Math.pow(0.9, 1.6); }
    v = Math.max(0, Math.min(255, v)); const i = p * 4; d[i] = d[i + 1] = d[i + 2] = v;
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
