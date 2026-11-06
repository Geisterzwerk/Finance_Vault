// =====================================================================
// scanui.js – Bedienung des Scanners
// · Dokument wird beim Laden automatisch gesucht (auch weiss auf weiss)
// · Ecken mit Lupe ziehen: Finger verdeckt die Ecke nicht mehr
// · Ecken bewegen sich relativ zum Finger (kein Springen)
// · Abstand zum Bildschirmrand, damit iOS-Wischgesten nicht auslösen
// =====================================================================
import { uid } from './store.js';
import { putFile } from './vault.js';
import * as SC from './scan.js';
import * as TP from './taxpack.js';
import { openResult } from './views-docs.js';
import { esc, isoDay, bar, openSheet, closeSheet, toast, chips, rerender } from './ui.js';

const PAD = 26;      // Rand um das Bild im Canvas (CSS-Pixel), Ecken bleiben greifbar
const HIT = 46;      // Greifradius in CSS-Pixel
const LOUPE = 118;   // Durchmesser Lupe
const ZOOM = 2.6;

export function openScanner() {
  const st = { pages: [], raw: [], img: null, corners: null, mode: 'gray', step: 'source', status: null };
  let cv = null, ctx = null, sc = 1, dpr = 1, drag = -1, grab = [0, 0], finger = null;

  const detect = (feedback) => {
    const r = SC.detectDocument(st.img);
    if (r && r.sure) { st.corners = r.corners; st.status = { c: 'pos', t: '✓ Dokument erkannt' }; }
    else if (r) { st.corners = r.corners; st.status = { c: 'amber', t: 'Vorschlag – bitte Ecken prüfen' }; }
    else {
      st.corners = SC.insetCorners(st.img.width, st.img.height, 0.04);
      st.status = { c: 'amber', t: 'Kein Dokument erkannt – Ecken ziehen. Tipp: dunkle Unterlage hilft.' };
    }
    if (feedback) toast(st.status.t);
    const s = document.querySelector('[data-status]'); if (s) { s.className = 'small center ' + st.status.c; s.textContent = st.status.t; }
    draw();
  };

  // Bildkoordinaten <-> Canvas (CSS-Pixel)
  const toCss = ([x, y]) => [PAD + x * sc, PAD + y * sc];
  const toImg = ([x, y]) => [(x - PAD) / sc, (y - PAD) / sc];

  const draw = () => {
    if (!cv || !st.img) return;
    const cw = cv.width / dpr, ch = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(st.img, PAD, PAD, st.img.width * sc, st.img.height * sc);
    const q = st.corners.map(toCss);
    // Abdunkeln ausserhalb
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cw, ch);
    ctx.moveTo(q[0][0], q[0][1]); for (let i = 3; i >= 0; i--) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath();
    ctx.fillStyle = 'rgba(12,22,38,.55)'; ctx.fill('evenodd'); ctx.restore();
    // Rahmen
    ctx.lineWidth = 2; ctx.strokeStyle = '#C9A45C';
    ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    // Ecken: dünner Ring + Punkt (genau sichtbar)
    q.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, i === drag ? 14 : 11, 0, 7);
      ctx.fillStyle = 'rgba(201,164,92,.18)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#E8CD96'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    });
    if (drag >= 0) drawLoupe(q[drag]);
  };

  // Lupe in der Ecke gegenüber dem Finger
  const drawLoupe = ([x, y]) => {
    const cw = cv.width / dpr; const r = LOUPE / 2;
    const left = finger ? finger[0] > cw / 2 : x > cw / 2;
    const lx = left ? r + 8 : cw - r - 8, ly = r + 8;
    const [ix, iy] = toImg([x, y]);
    const src = (r / ZOOM) / sc; // Bildpixel im Radius
    ctx.save();
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, 7); ctx.closePath();
    ctx.fillStyle = '#0C1626'; ctx.fill(); ctx.clip();
    ctx.drawImage(st.img, ix - src, iy - src, src * 2, src * 2, lx - r, ly - r, r * 2, r * 2);
    // Rahmenlinien in der Lupe
    const q = st.corners.map(([px, py]) => [lx + (px - ix) * sc * ZOOM, ly + (py - iy) * sc * ZOOM]);
    ctx.strokeStyle = '#C9A45C'; ctx.lineWidth = 2;
    ctx.beginPath(); q.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = '#E8CD96'; ctx.beginPath(); ctx.arc(lx, ly, r, 0, 7); ctx.stroke();
    // Fadenkreuz
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lx - 12, ly); ctx.lineTo(lx - 4, ly); ctx.moveTo(lx + 4, ly); ctx.lineTo(lx + 12, ly);
    ctx.moveTo(lx, ly - 12); ctx.lineTo(lx, ly - 4); ctx.moveTo(lx, ly + 4); ctx.lineTo(lx, ly + 12); ctx.stroke();
  };

  const render = () => {
    if (st.step === 'source') return `
      <div class="small mut">Fotografiere einen Brief oder eine Rechnung, oder wähle eine Datei (PDF aus Mail). Das Dokument wird automatisch gesucht. Texterkennung und QR-Rechnung laufen nur auf deinem Gerät.</div>
      <label class="btn gold block big mt">📷 Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-src="cam" hidden></label>
      <label class="btn line block">🖼 Foto aus Mediathek<input type="file" accept="image/*" data-src="img" hidden></label>
      <label class="btn line block">📄 PDF / Datei wählen<input type="file" accept="application/pdf,image/*" data-src="file" hidden></label>
      <div class="small mut mt">Tipp für beste Erkennung: Blatt auf eine dunklere Unterlage legen, von oben fotografieren, ganzes Blatt im Bild.</div>
      ${st.pages.length ? `<div class="note">${st.pages.length} Seite(n) erfasst</div><button class="btn gold block" data-act="finish">Fertig – erkennen</button>` : ''}`;
    if (st.step === 'crop') return `
      <div class="cropstage"><canvas id="cv"></canvas></div>
      <div data-status class="small center ${st.status ? st.status.c : ''}">${st.status ? esc(st.status.t) : ''}</div>
      <div class="small mut center">Ecke antippen und ziehen – die Lupe zeigt die genaue Position.</div>
      ${chips('mode', [['gray', 'Dokument'], ['bw', 'Schwarz/Weiss'], ['color', 'Farbe']], st.mode)}
      <div class="grid2"><button class="btn line" data-act="auto">✨ Automatisch</button><button class="btn line" data-act="fullimg">Ganzes Bild</button></div>
      <button class="btn gold block big" data-act="crop">Zuschneiden</button>`;
    if (st.step === 'page') return `
      <div class="lbl">Seite ${st.pages.length}</div>
      <div class="cropstage"><img src="${st.pages[st.pages.length - 1].toDataURL('image/jpeg', 0.6)}" alt="Seite"></div>
      <div class="grid2 mt"><label class="btn line">＋ Weitere Seite<input type="file" accept="image/*" capture="environment" data-src="cam" hidden></label><button class="btn line" data-act="redo">Neu aufnehmen</button></div>
      <button class="btn gold block big" data-act="finish">Fertig – erkennen</button>`;
    if (st.step === 'work') return `<div class="card center"><div class="serif big2">Erkenne Dokument …</div><div class="small mut" data-prog>${esc(st.prog || '')}</div>${bar(st.pct || 0)}</div>
      <div class="small mut">Beim ersten Mal werden die Erkennungs-Bibliotheken geladen (Internet nötig), danach geht es auch offline.</div>`;
    return '';
  };

  const startCrop = async (file) => {
    try {
      const im = await SC.loadImage(file);
      st.img = SC.toCanvas(im, 2200); st.step = 'crop'; st.status = null; st.corners = SC.insetCorners(st.img.width, st.img.height, 0.04);
      rerender();
      setTimeout(() => detect(false), 30);
    } catch (e) { toast('Bild nicht lesbar'); }
  };

  const finish = async (pdfFile) => {
    st.step = 'work'; rerender();
    const prog = (t, p) => { st.prog = t; st.pct = p; const el = document.querySelector('[data-prog]'); if (el) el.textContent = t; const b = document.querySelector('#sheet-body .bar i'); if (b) b.style.width = (p * 100) + '%'; };
    let blob, text = '', qr = null, name;
    try {
      if (pdfFile) {
        blob = pdfFile; name = pdfFile.name;
        if (pdfFile.type === 'application/pdf') { prog('Lese PDF-Text …', 0.3); try { text = await TP.pdfText(new Uint8Array(await pdfFile.arrayBuffer())); } catch (e) { text = ''; } }
      } else {
        prog('Erstelle PDF …', 0.1);
        blob = await SC.canvasesToPDF(st.pages); name = `Scan_${isoDay(new Date())}.pdf`;
        prog('Suche QR-Rechnung …', 0.2);
        for (const c of st.raw) { qr = SC.parseSwissQR(await SC.readQR(c)); if (qr) break; }
        try {
          const n = Math.min(3, st.pages.length);
          for (let i = 0; i < n; i++) text += (await SC.ocr(st.pages[i], (p) => prog(`Texterkennung Seite ${i + 1} …`, 0.25 + ((i + p) / n) * 0.75))) + '\n';
        } catch (e) { toast('Texterkennung offline nicht verfügbar – Felder bitte selbst ausfüllen'); }
      }
    } catch (e) { console.error(e); toast('Fehler bei der Erkennung'); }
    const f = SC.extractFields(text); const cls = SC.classify(text, qr);
    const year = new Date().getFullYear();
    const draft = {
      kind: cls.kind, issuer: (qr && qr.creditor) || f.issuer || '', title: cls.title || (qr && qr.message ? qr.message.slice(0, 60) : ''), number: (qr && qr.invoiceNo) || f.number || '',
      amount: qr && qr.amount != null ? qr.amount : f.amount ?? '',
      due: f.due || (qr && qr.invoiceDate && qr.payDays != null ? new Date(Date.parse(qr.invoiceDate) + qr.payDays * 864e5).toISOString().slice(0, 10) : ''), date: (qr && qr.invoiceDate) || f.date || isoDay(new Date()),
      category: cls.category, tax: cls.tax, ziffer: cls.ziffer, taxKind: cls.taxKind || '', taxStage: cls.taxStage || '',
      // Ohne Jahr im Text: provisorische Staats-/Gemeinderechnung gilt fürs laufende Jahr, Bundessteuer fürs Vorjahr
      taxYear: SC.guessTaxYear(text) || (cls.taxStage === 'provisorisch' && cls.taxKind !== 'Bund' ? year : year - 1),
      year: SC.guessTaxYear(text) || new Date(f.date || Date.now()).getFullYear(), iban: qr ? qr.iban : '', reference: (qr && qr.reference) || f.reference || '', customerRef: qr ? qr.customerRef || '' : '',
      text: text.slice(0, 6000), qr: !!qr,
    };
    const fid = uid(); await putFile(fid, new File([blob], name, { type: blob.type || 'application/pdf' }));
    closeSheet();
    openResult({ ...draft, file: fid, fileName: name });
  };

  const setupCanvas = (el) => {
    cv = el.querySelector('#cv'); if (!cv) return;
    const stage = el.querySelector('.cropstage');
    const cs = getComputedStyle(stage); const maxW = Math.min((stage.clientWidth || 320) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), 640);
    const maxH = Math.max(260, Math.min(window.innerHeight * 0.58, 720));
    sc = Math.min((maxW - 2 * PAD) / st.img.width, (maxH - 2 * PAD) / st.img.height);
    const cw = Math.round(st.img.width * sc + 2 * PAD), ch = Math.round(st.img.height * sc + 2 * PAD);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = cw * dpr; cv.height = ch * dpr; cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    ctx = cv.getContext('2d'); draw();
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e) => {
      e.preventDefault();
      const p = pos(e); let best = Infinity, idx = -1;
      st.corners.map(toCss).forEach(([x, y], i) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < best) { best = d; idx = i; } });
      if (best > HIT) return;
      drag = idx; finger = p;
      const c = toCss(st.corners[idx]); grab = [c[0] - p[0], c[1] - p[1]]; // relativ greifen
      cv.setPointerCapture(e.pointerId); draw();
    };
    const move = (e) => {
      if (drag < 0) return; e.preventDefault();
      const p = pos(e); finger = p;
      const [ix, iy] = toImg([p[0] + grab[0], p[1] + grab[1]]);
      st.corners[drag] = [Math.max(0, Math.min(st.img.width, ix)), Math.max(0, Math.min(st.img.height, iy))];
      draw();
    };
    const up = () => { drag = -1; finger = null; draw(); };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    // iOS: Scrollen/Wischen auf der Bühne verhindern
    stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    stage.addEventListener('touchstart', (e) => { if (e.touches.length === 1) e.preventDefault(); }, { passive: false });
  };

  openSheet({
    title: 'Dokument scannen', render,
    bind: (el) => {
      el.querySelectorAll('[data-src]').forEach((inp) => inp.addEventListener('change', () => {
        const f = inp.files[0]; inp.value = ''; if (!f) return;
        if (inp.dataset.src === 'file' && !f.type.startsWith('image/')) return finish(f);
        startCrop(f);
      }));
      if (st.step === 'crop') setupCanvas(el);
      el.addEventListener('click', async (e) => {
        const ch = e.target.closest('[data-chips=mode] .chip'); if (ch) { st.mode = ch.dataset.val; el.querySelectorAll('[data-chips=mode] .chip').forEach((c) => c.classList.toggle('sel', c === ch)); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'fullimg') { st.corners = [[0, 0], [st.img.width, 0], [st.img.width, st.img.height], [0, st.img.height]]; st.status = { c: 'mut', t: 'Ganzes Bild' }; draw(); const s = el.querySelector('[data-status]'); if (s) { s.className = 'small center mut'; s.textContent = 'Ganzes Bild'; } }
        if (a === 'auto') { b.disabled = true; b.textContent = 'Suche …'; setTimeout(() => { detect(true); b.disabled = false; b.textContent = '✨ Automatisch'; }, 20); }
        if (a === 'crop') {
          b.disabled = true; b.textContent = 'Zuschneiden …'; await new Promise((r) => setTimeout(r, 30));
          const w = SC.warp(st.img, st.corners);
          const rawCopy = document.createElement('canvas'); rawCopy.width = w.width; rawCopy.height = w.height; rawCopy.getContext('2d').drawImage(w, 0, 0);
          st.raw.push(rawCopy); st.pages.push(SC.enhance(w, st.mode)); st.step = 'page'; rerender();
        }
        if (a === 'redo') { st.pages.pop(); st.raw.pop(); st.step = 'source'; rerender(); }
        if (a === 'finish') finish();
      });
    },
  });
}
