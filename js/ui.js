// =====================================================================
// ui.js – Formatierung, Bottom-Sheets, Toast, Konfetti
// =====================================================================

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Zahlen ----------
const grp = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
export function chf(v, dec = 0, sign = false) {
  if (v == null || !Number.isFinite(v)) return '–';
  const n = Math.abs(v).toFixed(dec).split('.');
  return `${v < 0 ? '- ' : sign && v > 0 ? '+ ' : ''}CHF ${grp(n[0])}${n[1] ? '.' + n[1] : ''}`;
}
export function nr(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '–';
  const n = Math.abs(v).toFixed(dec).split('.');
  return (v < 0 ? '-' : '') + grp(n[0]) + (n[1] ? '.' + n[1] : '');
}
export function qty(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  return nr(v, a >= 1000 ? 2 : a >= 1 ? 4 : 8).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}
export function price(v) {
  if (v == null) return '–';
  const a = Math.abs(v);
  return chf(v, a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6);
}
export const pct = (v, sign = true) => (v == null || !Number.isFinite(v) ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(1)} %`);
export const cls = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

// ---------- Datum ----------
const p2 = (n) => String(n).padStart(2, '0');
export const dmy = (d) => { if (!d) return '–'; d = new Date(d); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const dmyShort = (d) => { if (!d) return '–'; d = new Date(d); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`; };
export const hm = (d) => { d = new Date(d); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const isoDay = (d) => { d = new Date(d); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export function ago(d) {
  if (!d) return 'nie';
  const days = Math.floor((Date.now() - new Date(d)) / 864e5);
  return days <= 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`;
}
export const daysUntil = (d) => Math.ceil((new Date(d + 'T23:59:59') - Date.now()) / 864e5);
export const greeting = () => { const h = new Date().getHours(); return h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : 'Guten Abend'; };
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MO = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const longDate = (d = new Date()) => `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]} ${d.getFullYear()}`;

// ---------- Sheets (Stapel) ----------
const stack = [];
export function openSheet(sheet) {
  const cur = stack[stack.length - 1];
  if (cur && cur.capture) cur.capture($('#sheet-body'));
  stack.push(sheet); render(false);
}
export function closeSheet() {
  stack.pop();
  if (stack.length) render(true);
  else { $('#sheet').classList.remove('open'); $('#sheet-bg').classList.remove('open'); }
}
export function closeAll() { stack.length = 0; $('#sheet').classList.remove('open'); $('#sheet-bg').classList.remove('open'); }
export function refreshSheet() { const s = stack[stack.length - 1]; if (s && s.live) render(true); }
export function rerender() { if (stack.length) render(true); }
export const sheetOpen = () => stack.length > 0;
function render(keep) {
  const s = stack[stack.length - 1];
  const body = $('#sheet-body'); const top = body.scrollTop;
  $('#sheet-title').textContent = s.title;
  $('#sheet-back').textContent = stack.length > 1 ? '‹ Zurück' : 'Schliessen';
  const inner = document.createElement('div');
  inner.innerHTML = s.render();
  body.replaceChildren(inner);
  $('#sheet').classList.add('open'); $('#sheet-bg').classList.add('open');
  if (s.bind) s.bind(inner);
  body.scrollTop = keep ? top : 0;
}

// ---------- Toast ----------
let tt;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Datei herunterladen ----------
export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

// ---------- Bausteine ----------
export const bar = (p, color = 'gold') => `<div class="bar"><i class="${color}" style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%"></i></div>`;
export const icon = (k) => ({ ok: '<span class="ic ok">✓</span>', warn: '<span class="ic warn">!</span>', bad: '<span class="ic bad">✕</span>' }[k] || '');
export function chips(name, opts, sel) {
  return `<div class="chips" data-chips="${name}">${opts.map(([v, l]) => `<button type="button" class="chip ${String(v) === String(sel) ? 'sel' : ''}" data-val="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}
export function bindChips(root, name, cb) {
  const box = root.querySelector(`[data-chips="${name}"]`); if (!box) return;
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    box.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel')); b.classList.add('sel'); cb && cb(b.dataset.val);
  });
}
export const chipVal = (root, name) => root.querySelector(`[data-chips="${name}"] .chip.sel`)?.dataset.val;

// ---------- Konfetti ----------
export function confetti(ms = 3200) {
  const c = document.createElement('canvas'); c.className = 'confetti';
  document.body.appendChild(c);
  const ctx = c.getContext('2d'); const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const cols = ['#C9A45C', '#E8CD96', '#3FB37F', '#588CDC', '#9678D2', '#E05D5D', '#F4EFE4', '#46AAB4'];
  const P = Array.from({ length: 180 }, () => ({
    x: Math.random() * c.width, y: -Math.random() * c.height * 0.6, w: (6 + Math.random() * 6) * dpr, h: (10 + Math.random() * 8) * dpr,
    vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.25,
    c: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.04 * dpr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.cos(p.r * 2)); ctx.restore();
    }
    if (t - t0 < ms) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
