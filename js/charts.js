// =====================================================================
// charts.js – Grafiken als reines SVG (keine Bibliothek, CSP-konform)
//
//  · ring()    Aufteilung (Teil vom Ganzen, max. 5 Farben + «Andere»).
//              Tippen auf Segment oder Legende zeigt Wert und Anteil in der Mitte.
//  · area()    Verlauf über die Zeit: glatte Linie 2px, zarte Fläche, Endpunkt mit
//              Ring, Fadenkreuz mit Wert beim Berühren. Optional Referenzlinie (Ø-Kauf).
//  · progress() kleiner Fortschrittsring (Ziele)
//
// Regeln: Farben folgen dem Objekt (nicht dem Rang), Texte nie in Datenfarbe,
// Beschriftung sparsam, jede Grafik hat eine Werte-Liste/Tabelle daneben.
// =====================================================================
import { esc } from './ui.js';

// Kategorische Palette – validiert für dunklen Grund (#26272A): Helligkeit, Sättigung,
// Farbenblindheit (ΔE ≥ 11.8 benachbart). Reihenfolge fix, nie zyklisch.
export const SLOTS = ['#bd8840', '#3577ab', '#3faa7d', '#ad4a4e', '#9076be'];
export const OTHER = '#6b6a68';

const reg = new Map(); let seq = 0;
const nid = () => 'c' + (++seq).toString(36);
const fmtDef = (v) => String(Math.round(v));

// ---------------------------------------------------------------------
// Ring
// segs: [{ label, value, color, sub }] – value > 0
// opts: { size, thick, center: { label, value, sub }, fmt(v) }
// ---------------------------------------------------------------------
export function ring(segs, opts = {}) {
  const size = opts.size || 220, thick = opts.thick || 12, r = (size - thick) / 2 - 2, c = size / 2;
  const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0);
  const id = nid();
  reg.set(id, { segs, total, center: opts.center, fmt: opts.fmt || fmtDef });
  const circ = 2 * Math.PI * r;
  const gap = segs.filter((s) => s.value > 0).length > 1 ? 2.5 : 0; // Abstand in px (Oberfläche trennt Segmente)
  let off = 0;
  const arcs = total > 0 ? segs.map((s, i) => {
    if (!(s.value > 0)) return '';
    const len = (s.value / total) * circ;
    const dash = Math.max(0.01, len - gap);
    const el = `<circle class="seg" data-i="${i}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thick}"
      stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${c} ${c})"
      tabindex="0" role="button" aria-label="${esc(s.label)}"><title>${esc(s.label)}</title></circle>`;
    off += len; return el;
  }).join('') : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${thick}"/>`;
  const cen = opts.center || {};
  return `<div class="ring" data-chart="${id}" style="--size:${size}px">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="false" role="img" aria-label="${esc(cen.label || 'Aufteilung')}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${thick}" opacity=".55"/>${arcs}
      <circle class="hit" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="transparent" stroke-width="${thick + 18}"/>
    </svg>
    <div class="ring-c"><div class="ring-l">${esc(cen.label || '')}</div><div class="ring-v">${esc(cen.value || '')}</div><div class="ring-s">${esc(cen.sub || '')}</div></div>
  </div>`;
}

// Legende/Werteliste zum Ring (gleichzeitig die Tabellen-Ansicht)
export function legend(segs, total, fmt, chartId = '') {
  return `<div class="legend-list" ${chartId ? `data-for="${chartId}"` : ''}>${segs.map((s, i) => `
    <div class="lg-row" data-i="${i}" tabindex="0" role="button"><i class="lg-dot" style="background:${s.color}"></i>
      <span class="grow">${esc(s.label)}${s.sub ? `<span class="lg-sub">${esc(s.sub)}</span>` : ''}</span>
      <span class="lg-pct">${total > 0 ? ((s.value / total) * 100).toFixed(0) : 0} %</span><b class="lg-v">${fmt(s.value)}</b></div>`).join('')}</div>`;
}
export const lastId = () => 'c' + seq.toString(36);

// ---------------------------------------------------------------------
// Verlauf (Fläche)
// pts: [{ t: ms, v: number }] aufsteigend; opts: { height, color, fmt, ref: { v, label }, dateFmt }
// ---------------------------------------------------------------------
function monotone(P) {
  // Fritsch–Carlson: glatt, ohne Überschwinger (keine erfundenen Spitzen)
  const n = P.length; if (n < 3) return P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const dx = [], dy = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; dy[i] = P[i + 1][1] - P[i][1]; m[i] = dy[i] / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(P[i][0] + h).toFixed(1)},${(P[i][1] + h * t[i]).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)},${(P[i + 1][1] - h * t[i + 1]).toFixed(1)} ${P[i + 1][0].toFixed(1)},${P[i + 1][1].toFixed(1)}`;
  }
  return d;
}
const W = 340;
export function area(pts, opts = {}) {
  pts = pts.filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return `<div class="chart-empty small mut">${esc(opts.empty || 'Noch zu wenig Daten für einen Verlauf.')}</div>`;
  const H = opts.height || 150, padT = 18, padB = 22, color = opts.color || SLOTS[0];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (opts.ref && Number.isFinite(opts.ref.v)) { lo = Math.min(lo, opts.ref.v); hi = Math.max(hi, opts.ref.v); }
  const span = hi - lo || Math.abs(hi) || 1; lo -= span * 0.08; hi += span * 0.08;
  const X = (t) => ((t - t0) / ((t1 - t0) || 1)) * (W - 8) + 4;
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const P = pts.map((p) => [X(p.t), Y(p.v)]);
  const line = monotone(P);
  const base = H - padB;
  const id = nid(); const gid = 'g' + id;
  reg.set(id, { pts, X, Y, fmt: opts.fmt || fmtDef, dateFmt: opts.dateFmt, H, color });
  const last = P[P.length - 1]; const maxI = pts.reduce((b, p, i) => (p.v > pts[b].v ? i : b), 0);
  const long = t1 - t0 > 180 * 864e5;
  const df = opts.dateFmt || ((t) => new Date(t).toLocaleDateString('de-CH', long ? { month: 'short', year: '2-digit' } : { day: '2-digit', month: 'short' }));
  const ref = opts.ref && Number.isFinite(opts.ref.v) ? `<line x1="4" x2="${W - 4}" y1="${Y(opts.ref.v).toFixed(1)}" y2="${Y(opts.ref.v).toFixed(1)}" class="ref"/>
    <text x="${W - 6}" y="${(Y(opts.ref.v) - 5).toFixed(1)}" text-anchor="end" class="ax">${esc(opts.ref.label)} ${esc((opts.fmt || fmtDef)(opts.ref.v))}</text>` : '';
  const showMax = maxI !== pts.length - 1 && P[maxI][0] > 40 && P[maxI][0] < W - 60;
  return `<div class="area" data-chart="${id}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="area-svg" style="height:${H}px" role="img" aria-label="${esc(opts.label || 'Verlauf')}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <line x1="4" x2="${W - 4}" y1="${base}" y2="${base}" class="grid"/>
      <path d="${line}L${last[0].toFixed(1)},${base}L${P[0][0].toFixed(1)},${base}Z" fill="url(#${gid})"/>
      ${ref}
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <line class="xh" x1="0" x2="0" y1="${padT - 6}" y2="${base}" visibility="hidden"/>
    </svg>
    <span class="dot end" style="left:${(last[0] / W * 100).toFixed(2)}%;top:${last[1].toFixed(1)}px;background:${color}"></span>
    <span class="dot cur" style="background:${color}" hidden></span>
    ${showMax ? `<span class="pk" style="left:${(P[maxI][0] / W * 100).toFixed(2)}%;top:${(P[maxI][1] - 16).toFixed(1)}px">${esc((opts.fmt || fmtDef)(pts[maxI].v))}</span>` : ''}
    <div class="ax-row"><span>${esc(df(t0))}</span><span>${esc(df(t1))}</span></div>
    <div class="tip" hidden></div>
  </div>`;
}

// ---------------------------------------------------------------------
// Fortschrittsring (Ziele)
// ---------------------------------------------------------------------
export function progress(p, color = SLOTS[0], size = 54) {
  const th = 5, r = (size - th) / 2, c = size / 2, circ = 2 * Math.PI * r, v = Math.max(0, Math.min(1, p));
  return `<svg class="prog" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${(v * 100).toFixed(0)} %">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${th}"/>
    ${v > 0 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${th}" stroke-linecap="round" stroke-dasharray="${(circ * v).toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>` : ''}
    <text x="${c}" y="${c + 4}" text-anchor="middle" class="prog-t">${(v * 100).toFixed(0)}%</text></svg>`;
}

// ---------------------------------------------------------------------
// Interaktion (einmal global): Ring-Auswahl und Fadenkreuz
// ---------------------------------------------------------------------
function ringSelect(el, i) {
  const d = reg.get(el.dataset.chart); if (!d) return;
  const box = el.querySelector('.ring-c');
  const same = el.dataset.sel === String(i);
  el.dataset.sel = same || i == null ? '' : String(i);
  el.querySelectorAll('.seg').forEach((s) => s.classList.toggle('dim', !same && i != null && s.dataset.i !== String(i)));
  const list = el.closest('.ringwrap')?.querySelectorAll('.lg-row');
  list?.forEach((r) => r.classList.toggle('on', !same && i != null && r.dataset.i === String(i)));
  const set = (l, v, s) => { box.querySelector('.ring-l').textContent = l; box.querySelector('.ring-v').textContent = v; box.querySelector('.ring-s').textContent = s; };
  if (same || i == null) { const cn = d.center || {}; set(cn.label || '', cn.value || '', cn.sub || ''); return; }
  const s = d.segs[i];
  set(s.label, d.fmt(s.value), d.total > 0 ? `${((s.value / d.total) * 100).toFixed(1)} % vom Total` : '');
}
document.addEventListener('click', (e) => {
  const seg = e.target.closest && e.target.closest('.ring .seg');
  if (seg) return ringSelect(seg.closest('.ring'), seg.dataset.i);
  const row = e.target.closest && e.target.closest('.ringwrap .lg-row');
  if (row) { const r = row.closest('.ringwrap').querySelector('.ring'); if (r) ringSelect(r, row.dataset.i); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target; if (!t.closest) return;
  if (t.matches('.ring .seg')) { e.preventDefault(); ringSelect(t.closest('.ring'), t.dataset.i); }
  if (t.matches('.ringwrap .lg-row')) { e.preventDefault(); const r = t.closest('.ringwrap').querySelector('.ring'); if (r) ringSelect(r, t.dataset.i); }
});

function crosshair(el, clientX) {
  const d = reg.get(el.dataset.chart); if (!d) return;
  const rect = el.getBoundingClientRect(); const x = ((clientX - rect.left) / rect.width) * W;
  let bi = 0, bd = Infinity; d.pts.forEach((p, i) => { const dd = Math.abs(d.X(p.t) - x); if (dd < bd) { bd = dd; bi = i; } });
  const p = d.pts[bi]; const px = d.X(p.t), py = d.Y(p.v);
  const xh = el.querySelector('.xh'); xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('visibility', 'visible');
  const dot = el.querySelector('.dot.cur'); dot.hidden = false; dot.style.left = (px / W * 100) + '%'; dot.style.top = py + 'px';
  const v = document.createElement('b'); v.textContent = d.fmt(p.v);
  const t = document.createElement('span'); t.className = 'mut small'; t.textContent = new Date(p.t).toLocaleDateString('de-CH', { day: '2-digit', month: 'short', year: 'numeric' });
  // Wie in Finanz-Apps: der berührte Wert ersetzt oben die Kopfzahl (nichts wird verdeckt)
  const head = el.closest('.card')?.querySelector('.trend-h');
  if (head) {
    if (!head.dataset.saved) { head.dataset.saved = '1'; head._orig = [...head.childNodes].map((n) => n.cloneNode(true)); }
    head.replaceChildren(v, t); return;
  }
  const tip = el.querySelector('.tip'); tip.hidden = false; tip.replaceChildren(v, t);
  tip.style.left = Math.min(Math.max(px / W * rect.width, 56), rect.width - 56) + 'px';
}
function hide(el) {
  el.querySelector('.xh')?.setAttribute('visibility', 'hidden');
  const dot = el.querySelector('.dot.cur'); if (dot) dot.hidden = true;
  const tip = el.querySelector('.tip'); if (tip) tip.hidden = true;
  const head = el.closest('.card')?.querySelector('.trend-h');
  if (head && head.dataset.saved) { head.replaceChildren(...head._orig); delete head.dataset.saved; }
}
document.addEventListener('pointermove', (e) => { const el = e.target.closest && e.target.closest('.area[data-chart]'); if (el) crosshair(el, e.clientX); });
document.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('.area[data-chart]'); if (el) crosshair(el, e.clientX); });
document.addEventListener('pointerleave', (e) => { if (e.target.matches && e.target.matches('.area[data-chart]')) hide(e.target); }, true);
document.addEventListener('pointerup', (e) => { const el = e.target.closest && e.target.closest('.area[data-chart]'); if (el && e.pointerType === 'touch') setTimeout(() => hide(el), 1800); });

// Registry aufräumen, wenn Ansichten ersetzt werden (verhindert Speicherwachstum)
export function gc() { for (const id of reg.keys()) if (!document.querySelector(`[data-chart="${id}"]`)) reg.delete(id); }
