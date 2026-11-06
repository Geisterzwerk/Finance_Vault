// =====================================================================
// taxpack.js – Jahresabschluss, Steuerpaket (ZIP), Steuerzahlungen,
// Erinnerungen (Kalender) und Prüfung der eingereichten Steuererklärung.
// =====================================================================
import { S } from './store.js';
import { yearEndHoldings, accountAt } from './calc.js';
import { reminderDates, calendar } from './taxcal.js';
import { getFileBytes } from './vault.js';
import * as LIB from './libs.js';

const p2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chf = (v) => (v == null ? '–' : 'CHF ' + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'"));
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safe = (s) => String(s || 'Dokument').replace(/[^\w.\-äöüÄÖÜ ]+/g, '_').slice(0, 60);

// ---------- Jahresabschluss: Datencheck ----------
export function yearEndCheck(y) {
  const s = S(); const end = new Date(y, 11, 31, 23, 59).getTime();
  const items = [];
  const imp = (name, label) => {
    const im = s.imports[name]; if (!im) return;
    const cover = im.toMs || (im.to ? new Date(String(im.to).replace(' ', 'T')).getTime() : new Date(im.last).getTime());
    const ok = cover >= end - 7 * 864e5 || new Date(im.last).getTime() > end;
    items.push({ label, ok, warn: !ok, detail: ok ? `aktuell · ${String(im.to || im.last).slice(0, 10)}` : `veraltet · ${String(im.to || im.last).slice(0, 10)}`, fix: '#/vault' });
  };
  imp('BingX', 'BingX'); imp('Relai', 'Relai');
  for (const a of s.accounts) {
    const t = new Date(a.updated).getTime();
    const ok = t >= end - 20 * 864e5;
    items.push({ label: a.name, ok, warn: !ok, detail: ok ? `Stand ${String(a.updated).slice(0, 10)}` : `veraltet · ${String(a.updated).slice(0, 10)}`, fix: '#/invest' });
  }
  if (s.ledger && s.ledger.addresses && s.ledger.addresses.length) {
    const t = s.ledger.last ? new Date(s.ledger.last.at).getTime() : 0;
    items.push({ label: 'Ledger-Abgleich', ok: t > end - 14 * 864e5, warn: t <= end - 14 * 864e5, detail: t ? String(s.ledger.last.at).slice(0, 10) : 'nie', fix: '#/vault/ledger' });
  }
  const hidden = new Set(s.settings.ignoredAssets || []);
  const review = s.transactions.filter((x) => x.type === 'review' && !hidden.has(x.asset) && new Date(x.date).getTime() <= end).length;
  items.push({ label: 'Offene Zuordnungen', ok: !review, warn: !!review, detail: review ? `${review} offen` : 'keine', fix: '#/vault/pruefen' });
  const hold = Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8);
  const rates = (s.taxYears[y] || {}).rates || {};
  const miss = hold.filter((h) => !rates[h.asset]).length;
  items.push({ label: 'Steuerkurse 31.12.', ok: !miss, warn: !!miss, detail: miss ? `${miss} fehlen` : 'vollständig', fix: '#/steuern' });
  return { items, ready: items.every((i) => i.ok) };
}

// Soll der Jahresabschluss angezeigt werden? (31.12. bis 31.3.)
export function closingDue() {
  const now = new Date(); const s = S();
  const y = now.getMonth() === 11 && now.getDate() === 31 ? now.getFullYear() : now.getMonth() <= 2 ? now.getFullYear() - 1 : null;
  if (!y) return null;
  const t = s.taxYears[y];
  if (t && t.closed) return null;
  if (!s.transactions.length && !s.accounts.length) return null;
  return y;
}

// ---------- Steuerzahlungen ----------
export const TAX_KINDS = ['Staat BL', 'Gemeinde', 'Bund', 'Andere'];
export function taxPayments(y) {
  const list = S().invoices.filter((i) => i.category === 'Steuern' && +i.taxYear === +y);
  const by = {}; let soll = 0, paid = 0;
  for (const i of list) {
    const k = i.taxKind || 'Andere'; (by[k] ||= { soll: 0, paid: 0, items: [] });
    by[k].soll += +i.amount || 0; by[k].items.push(i); soll += +i.amount || 0;
    if (i.status === 'paid') { by[k].paid += +i.amount || 0; paid += +i.amount || 0; }
  }
  return { by, soll, paid, open: soll - paid, list };
}

// ---------- Erinnerungen als Kalender-Datei ----------
export function remindersICS() {
  const s = S(); const now = new Date(); const ev = [];
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const day = (d) => d.replace(/-/g, '');
  const add = (id, date, title, alarm = '-P1D', rrule) => ev.push(['BEGIN:VEVENT', `UID:${id}@financevault`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(date)}`,
    `SUMMARY:${title}`, ...(rrule ? [`RRULE:${rrule}`] : []), 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, `TRIGGER:${alarm}`, 'END:VALARM', 'END:VEVENT'].join('\r\n'));
  const y = now.getFullYear();
  add(`yearend-${y}`, `${y}-12-31`, 'Finance Vault: Zeit für den Jahresabschluss', 'PT9H');
  add(`yearend2-${y}`, `${y + 1}-01-02`, 'Finance Vault: Jahresabschluss erledigt? Daten aktualisieren', 'PT9H');
  add(`taxdocs-${y + 1}`, `${y + 1}-01-20`, 'Finance Vault: Steuerdokumente erwartet (Lohnausweis, 3a, Bank)', 'PT9H');
  add('monthly', `${y}-${p2(now.getMonth() + 1)}-01`, 'Finance Vault: Monats-Update (BingX, Relai, Kontostände)', 'PT9H', 'FREQ=MONTHLY;BYMONTHDAY=1');
  for (const r of reminderDates()) add(r.id, r.day, 'Finance Vault: ' + r.body, 'PT9H');
  for (const i of s.invoices) if (i.status === 'open' && i.due && i.category !== 'Steuern') {
    add(`inv-${i.id}`, i.due, 'Finance Vault: Rechnung fällig', '-P2D');
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finance Vault//DE', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n');
}

// ---------- ZIP (ohne Kompression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u) => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  const now = new Date(); const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const f of files) {
    const name = enc.encode(f.name); const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data); const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

const fileBytes = (id) => getFileBytes(id);
const KINDS = { bank: 'Bank', cash: 'Bargeld', securities: 'Wertschriften', pillar3a: 'Säule 3a', liability: 'Schuld' };
const CHECK_LABELS = [['lohn', 'Lohnausweis'], ['weg', 'Arbeitsweg'], ['verpfl', 'Auswärtige Verpflegung'], ['beruf', 'Übrige Berufskosten'], ['3a', 'Säule 3a Bescheinigung'],
  ['bildung', 'Aus- und Weiterbildung'], ['krank', 'Krankheitskosten'], ['spenden', 'Spenden'], ['bank', 'Bank-Steuerauszüge'], ['crypto', 'Crypto-Steuerbericht']];

// ---------- Steuerpaket ----------
export async function buildPackage(y) {
  const s = S(); const t = s.taxYears[y] || { rates: {}, checklist: {} };
  const snap = t.closed ? t.snapshot : null;
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8).map((x) => ({ asset: x.asset, qty: x.qty }));
  const rates = snap ? snap.rates : t.rates || {};
  let total = 0; for (const h of hold) if (rates[h.asset]) total += h.qty * rates[h.asset].chf;
  const files = [];
  // Belege des Jahres
  const inYear = (d) => d && new Date(d).getFullYear() === y;
  const receipts = s.invoices.filter((i) => i.tax !== 'no' && i.category !== 'Steuern' && inYear(i.paidAt || i.due));
  const docs = (s.documents || []).filter((d) => d.status !== 'inbox' && (+d.year === y));
  const folder = (cat) => ({ Einkommen: '05_Einkommen', Vorsorge: '04_Vorsorge', Vermögen: '03_Banken_Vermoegen', Studium: '06_Abzuege/Weiterbildung', Gesundheit: '06_Abzuege/Gesundheit', Spenden: '06_Abzuege/Spenden', Mobilität: '06_Abzuege/Arbeitsweg' }[cat] || '07_Sonstiges');
  for (const i of receipts) if (i.file) {
    const f = await fileBytes(i.file); if (f) files.push({ name: `${folder(i.category)}/${safe(i.issuer)}_${safe(i.number || i.id)}${ext(f)}`, data: f.bytes });
  }
  for (const d of docs) if (d.file) {
    const f = await fileBytes(d.file);
    const base = d.kind === 'erklaerung' ? '08_Eingereicht' : d.kind === 'veranlagung' ? '09_Veranlagung' : folder(d.category);
    if (f) files.push({ name: `${base}/${safe(d.title || d.issuer)}_${d.id.slice(-4)}${ext(f)}`, data: f.bytes });
  }
  // Crypto-CSV
  const lines = ['Asset;Bestand 31.12.' + y + ';Steuerkurs CHF;Steuerwert CHF;Kursquelle'];
  hold.forEach((h) => { const r = rates[h.asset]; lines.push([h.asset, h.qty, r ? r.chf : '', r ? (h.qty * r.chf).toFixed(2) : '', r ? r.source : 'fehlt'].join(';')); });
  lines.push(`Total;;;${total.toFixed(2)};`);
  files.push({ name: `02_Investments/Crypto_Steuerbericht_${y}.csv`, data: '\uFEFF' + lines.join('\n') });
  // Übersicht
  const byZ = {}; receipts.forEach((i) => { (byZ[i.ziffer || '–'] ||= []).push(i); });
  const pay = taxPayments(y);
  const html = `<!doctype html><meta charset="utf-8"><title>Steuern ${y}</title>
<style>body{font:14px/1.45 Georgia,serif;max-width:820px;margin:30px auto;color:#111;padding:0 16px}h1{border-bottom:2px solid #C9A45C;padding-bottom:6px}h2{margin-top:28px;color:#0C1626}
.k{font:700 11px Arial;letter-spacing:.2em;color:#B89148}table{width:100%;border-collapse:collapse;font:13px Arial}th{background:#0C1626;color:#F4EFE4;text-align:left;padding:6px}td{padding:6px;border-bottom:1px solid #ddd}.r{text-align:right}.mut{color:#666;font-size:12px}</style>
<div class="k">FINANCE VAULT · STEUERPAKET</div><h1>Steuerjahr ${y}</h1>
<p>${esc(s.settings.name)} · Kanton ${esc(s.settings.canton)} · erstellt am ${new Date().toLocaleDateString('de-CH')}${snap ? ' · Snapshot 31.12. abgeschlossen' : ' · Entwurf (Jahr nicht abgeschlossen)'}</p>
<h2>Was muss ich wo eintragen?</h2><table><tr><th>Ziffer</th><th>Bereich</th><th class="r">Betrag</th><th>Belege</th></tr>
<tr><td>800</td><td>Kryptowährungen (je Coin eine Position)</td><td class="r">${chf(total)}</td><td>02_Investments</td></tr>
${Object.entries(byZ).map(([z, l]) => `<tr><td>${esc(z)}</td><td>${esc([...new Set(l.map((i) => i.category))].join(', '))}</td><td class="r">${chf(l.reduce((a, i) => a + (+i.amount || 0), 0))}</td><td>${l.length} Beleg(e)</td></tr>`).join('')}
${docs.filter((d) => d.ziffer).map((d) => `<tr><td>${esc(d.ziffer)}</td><td>${esc(d.title || d.category)}</td><td class="r">${d.amount ? chf(d.amount) : 'siehe Dokument'}</td><td>${esc(folder(d.category))}</td></tr>`).join('')}
</table>
<h2>Kryptowährungen per 31.12.${y}</h2><table><tr><th>Asset</th><th class="r">Bestand</th><th class="r">Steuerkurs</th><th class="r">Steuerwert</th><th>Quelle</th></tr>
${hold.map((h) => { const r = rates[h.asset]; return `<tr><td>${esc(h.asset)}</td><td class="r">${h.qty}</td><td class="r">${r ? r.chf : '–'}</td><td class="r">${r ? chf(h.qty * r.chf) : 'fehlt'}</td><td>${r ? esc(r.source) : ''}</td></tr>`; }).join('')}
<tr><td><b>Total</b></td><td></td><td></td><td class="r"><b>${chf(total)}</b></td><td></td></tr></table>
<h2>Konten per 31.12.${y}</h2><table><tr><th>Konto</th><th>Art</th><th class="r">Stand 31.12.</th><th>Grundlage</th></tr>
${s.accounts.map((a) => { const v = accountAt(a, new Date(y, 11, 31, 23, 59).getTime()); return `<tr><td>${esc(a.name)}</td><td>${esc(KINDS[a.kind] || a.kind)}</td><td class="r">${v == null ? '–' : chf(v)}</td><td class="mut">${v == null ? 'kein Stand vor 31.12.' : 'letzter erfasster Stand'}</td></tr>`; }).join('')}</table>
<p class="mut">Massgebend ist der Stand per 31.12. laut Bank-/Vorsorge-Steuerauszug. Die App zeigt den letzten von dir erfassten Stand bis zu diesem Datum.</p>
<h2>Steuerzahlungen ${y}</h2><table><tr><th>Steuer</th><th class="r">Soll</th><th class="r">Bezahlt</th><th class="r">Offen</th></tr>
${Object.entries(pay.by).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${chf(v.soll)}</td><td class="r">${chf(v.paid)}</td><td class="r">${chf(v.soll - v.paid)}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td class="r"><b>${chf(pay.soll)}</b></td><td class="r"><b>${chf(pay.paid)}</b></td><td class="r"><b>${chf(pay.open)}</b></td></tr></table>
<h2>Fristen</h2><table><tr><th>Was</th><th>Bis</th><th class="r">Offen</th><th>Status</th></tr>
${calendar().map((x) => `<tr><td>${esc(x.title)}</td><td>${x.due.split('-').reverse().join('.')}</td><td class="r">${x.type === 'pay' ? chf(x.invoices.length ? x.open : x.estimate) : ''}</td><td>${x.done ? 'erledigt' : x.days < 0 ? 'überfällig' : 'offen'}</td></tr>`).join('')}</table>
<h2>Checkliste</h2><ul>${CHECK_LABELS.map(([k, l]) => `<li>${(t.checklist || {})[k] ? '✓' : '○'} ${esc(l)}</li>`).join('')}</ul>
<p class="mut">Ziffern aus der Steuererklärung 2023 (E-Tax BL), jährlich prüfen. Organisationshilfe, keine Steuerberatung.</p>`;
  files.unshift({ name: `01_Uebersicht_Steuern_${y}.html`, data: html });
  return { blob: zip(files), count: files.length };
}
const ext = (f) => (f.type === 'application/pdf' ? '.pdf' : f.type === 'image/png' ? '.png' : f.type.startsWith('image/') ? '.jpg' : (f.name && /\.\w+$/.exec(f.name) ? /\.\w+$/.exec(f.name)[0] : ''));

// ---------- Prüfung der eingereichten Steuererklärung ----------
export async function pdfText(bytes) {
  const pdfjs = await LIB.pdfjs();
  // isEvalSupported: false schützt vor CVE-2024-4367 (Code-Ausführung über präparierte PDF-Schriften)
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out += tc.items.map((i) => i.str).join(' ') + '\n';
  }
  return out;
}

export function audit(y, text) {
  const s = S(); const flat = text.replace(/[’'\u00A0]/g, '').replace(/\s+/g, ' ');
  const has = (v) => {
    if (v == null || !Number.isFinite(v)) return false;
    const i = Math.round(v); const cands = [String(i), i.toFixed(0), v.toFixed(2), v.toFixed(2).replace('.', ',')];
    return cands.some((c) => c.length >= 2 && new RegExp(`(^|[^\\d])${c.replace('.', '\\.')}([^\\d]|$)`).test(flat));
  };
  const res = [];
  const t = s.taxYears[y] || {}; const snap = t.closed ? t.snapshot : null;
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8);
  const rates = snap ? snap.rates : t.rates || {};
  let total = 0;
  for (const h of hold) {
    const r = rates[h.asset]; const v = r ? h.qty * r.chf : null; if (v) total += v;
    const nameHit = new RegExp(`\\b${reEsc(h.asset)}\\b`, 'i').test(flat) || (CN[h.asset] && CN[h.asset].test(flat));
    if (v != null && v < 50) continue;
    res.push({ label: `Crypto ${h.asset}`, st: nameHit ? (v == null || has(v) ? 'ok' : 'warn') : 'bad',
      detail: nameHit ? (v == null || has(v) ? 'gefunden' : `Coin gefunden, Wert ${chf(v)} nicht gefunden`) : 'nicht in der Erklärung gefunden' });
  }
  if (total) res.push({ label: 'Crypto total', st: has(total) ? 'ok' : 'warn', detail: has(total) ? chf(total) + ' gefunden' : `Vault ${chf(total)} – Betrag nicht exakt gefunden (Rundung/Kurs?)` });
  const inYear = (d) => d && new Date(d).getFullYear() === y;
  const byZ = {}; s.invoices.filter((i) => i.tax !== 'no' && i.category !== 'Steuern' && inYear(i.paidAt || i.due)).forEach((i) => { (byZ[i.ziffer || '–'] ||= []).push(i); });
  for (const [z, l] of Object.entries(byZ)) {
    const sum = l.reduce((a, i) => a + (+i.amount || 0), 0);
    const any = has(sum) || l.some((i) => has(+i.amount));
    res.push({ label: `Ziffer ${z} (${l.map((i) => i.issuer).slice(0, 2).join(', ')})`, st: any ? 'ok' : 'bad', detail: any ? `${chf(sum)} gefunden` : `Beleg(e) über ${chf(sum)} vorhanden, Betrag nicht gefunden – Abzug vergessen?` });
  }
  for (const a of s.accounts.filter((x) => x.kind !== 'liability')) {
    const words = a.name.split(/\s+/).filter((w) => w.length > 3);
    const hit = words.some((w) => new RegExp(reEsc(w), 'i').test(flat));
    res.push({ label: a.name, st: hit ? 'ok' : 'warn', detail: hit ? 'erwähnt' : 'Name nicht gefunden – deklariert?' });
  }
  const ok = res.filter((r) => r.st === 'ok').length;
  return { res, score: res.length ? Math.round((ok / res.length) * 100) : 0 };
}
const CN = { BTC: /bitcoin/i, ETH: /ethereum/i, XRP: /ripple|\bxrp\b/i, SOL: /solana/i, LINK: /chainlink/i, KAS: /kaspa/i, AVAX: /avalanche/i, SUI: /\bsui\b/i, SEI: /\bsei\b/i, ONDO: /ondo/i, NEAR: /\bnear\b/i, HYPE: /hyperliquid/i, QNT: /quant/i, KTA: /keeta/i, USDC: /usd\s?coin|usdc/i, USDT: /tether|usdt/i };
