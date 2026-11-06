// =====================================================================
// taxpack.js – Jahresabschluss, Steuerpaket (ZIP), Steuerzahlungen,
// Erinnerungen (Kalender) und Prüfung der eingereichten Steuererklärung.
// =====================================================================
import { S } from './store.js';
import { yearEndHoldings } from './calc.js';
import { reminderDates, calendar } from './taxcal.js';
import { mappe, totals } from './taxdocs.js';
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

// ---------- Steuerpaket: Bericht + Belege in Ordnerstruktur ----------
const FOLDER = { Start: '01_Zugang_E-Tax', Einkommen: '02_Einkommen', Berufsauslagen: '03_Berufsauslagen', Vorsorge: '04_Vorsorge_3a',
  Vermögen: '05_Vermoegen_Banken_Depots', Abzüge: '07_Abzuege', Weitere: '08_Weitere' };
const f0 = (v) => (v == null || v === '' ? '' : Number(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, "'"));
export function reportHTML(y) {
  const s = S(); const items = mappe(y); const tot = totals(items);
  const prevYear = Object.keys(s.taxYears).map(Number).filter((x) => x < y && s.taxYears[x].declared).sort((a, b) => b - a)[0];
  const prevV = prevYear ? s.taxYears[prevYear].declared.values || {} : {};
  const rows = items.filter((i) => i.ziffer && !i.wsv && i.status !== 'nicht');
  const wsv = items.filter((i) => i.wsv && i.status !== 'nicht');
  const missing = items.filter((i) => i.status === 'fehlt');
  const coins = (items.find((i) => i.id === 'krypto') || {}).coins || [];
  const st = (i) => (i.status === 'eingetragen' ? '✓ eingetragen' : i.status === 'da' ? (i.docs.length ? 'Beleg da' : 'automatisch') : 'fehlt');
  const docs = (i) => i.docs.map((d) => esc(d.fileName || d.title)).join('<br>') || '<span class="mut">–</span>';
  return `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Steuern ${y} – Was trage ich wo ein</title>
<style>:root{--g:#a97a4f}body{font:14px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#1d1e20;max-width:900px;margin:32px auto;padding:0 18px}
h1{font-weight:500;letter-spacing:-.02em;font-size:30px;margin:4px 0 4px}h2{font-weight:600;font-size:17px;margin:30px 0 8px;padding-bottom:6px;border-bottom:1.5px solid var(--g)}
.k{font-size:11px;letter-spacing:.24em;color:var(--g);font-weight:600}table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}
th{text-align:left;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#77736d;border-bottom:1px solid #ccc;padding:6px 6px}
td{padding:7px 6px;border-bottom:1px solid #eee;vertical-align:top}.r{text-align:right;font-variant-numeric:tabular-nums}.mut{color:#888;font-size:12px}
.tot td{font-weight:600;border-top:1.5px solid #1d1e20}.box{background:#f6f2ec;border-radius:10px;padding:10px 14px;margin:10px 0}.miss{color:#b5482f}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style>
<div class="k">FINANCE VAULT · STEUERERKLÄRUNG</div><h1>Steuerjahr ${y} – Was trage ich wo ein</h1>
<div class="mut">${esc(s.settings.name)} · Kanton ${esc(s.settings.canton)} · E-Tax BL · erstellt am ${new Date().toLocaleDateString('de-CH')}</div>
${missing.length ? `<div class="box miss"><b>Noch offen:</b> ${missing.map((i) => esc(i.label)).join(', ')}</div>` : '<div class="box">Alle Belege beisammen.</div>'}
<h2>Einkünfte und Abzüge (Seiten 2–3)</h2>
<table><tr><th>Ziff.</th><th>Bezeichnung</th><th class="r">Staat</th><th class="r">Bund</th><th class="r">${prevYear ? 'Erklärung ' + prevYear : 'Vorjahr'}</th><th>Beleg</th><th>Status</th></tr>
${rows.map((i) => `<tr><td>${i.ziffer}</td><td>${esc(i.label)}<div class="mut">${esc(i.value && i.value.detail || '')}</div></td><td class="r">${f0(i.value && i.value.staat)}</td><td class="r">${f0(i.value && (i.value.bund ?? i.value.staat))}</td>
  <td class="r mut">${prevV[i.ziffer] ? f0(prevV[i.ziffer].staat) + (prevV[i.ziffer].bund !== prevV[i.ziffer].staat ? ' / ' + f0(prevV[i.ziffer].bund) : '') : ''}</td><td class="mut">${docs(i)}</td><td>${st(i)}</td></tr>`).join('')}</table>
<h2>Wertschriften- und Guthabenverzeichnis</h2>
<table><tr><th>Position</th><th class="r">Steuerwert 31.12.</th><th class="r">Ertrag A</th><th class="r">Ertrag B</th><th>Beleg</th></tr>
${wsv.filter((i) => i.id !== 'krypto').map((i) => `<tr><td>${esc(i.label)}<div class="mut">${i.value && i.value.estimate ? 'Schätzung – Steuerauszug fehlt' : 'E-Steuerauszug: in E-Tax importieren'}</div></td><td class="r">${f0(i.value && i.value.staat)}</td><td class="r">${f0(i.value && i.value.ertragA)}</td><td class="r">${f0(i.value && i.value.ertragB)}</td><td class="mut">${docs(i)}</td></tr>`).join('')}
${coins.map((c) => `<tr><td>KRY · ${esc(c.asset)} <span class="mut">${c.qty} Stück × ${c.rate ?? 'Kurs fehlt'}</span></td><td class="r">${c.rate != null ? f0(c.qty * c.rate) : 'fehlt'}</td><td class="r">0</td><td class="r">0</td><td class="mut">06_Krypto</td></tr>`).join('')}
<tr class="tot"><td>Total → Ziffer 800 / 300</td><td class="r">${f0(tot[800])}</td><td class="r">${f0(tot[970])}</td><td class="r">${f0(tot[971])}</td><td></td></tr></table>
<table><tr><th>Ziff.</th><th>Übertrag Seite 1/4</th><th class="r">Betrag</th></tr>
<tr><td>800</td><td>Wertschriften und Guthaben</td><td class="r">${f0(tot[800])}</td></tr><tr><td>300</td><td>Erträge aus Guthaben und Wertschriften</td><td class="r">${f0(tot[300])}</td></tr>
<tr><td>970</td><td>Bruttoertrag A (mit Verrechnungssteuer)</td><td class="r">${f0(tot[970])}</td></tr><tr><td>971</td><td>Bruttoertrag B</td><td class="r">${f0(tot[971])}</td></tr>
<tr><td>972</td><td>Verrechnungssteuer-Anspruch (35 % von A)</td><td class="r">${tot[972].toFixed(2)}</td></tr></table>
<h2>Fristen und Zahlungen</h2><table><tr><th>Was</th><th>Bis</th><th class="r">Offen CHF</th><th>Status</th></tr>
${calendar().map((x) => `<tr><td>${esc(x.title)}</td><td>${x.due.split('-').reverse().join('.')}</td><td class="r">${x.type === 'pay' ? f0(x.invoices.length ? x.open : x.estimate) : ''}</td><td>${x.done ? 'erledigt' : x.days < 0 ? 'überfällig' : 'offen'}</td></tr>`).join('')}</table>
<h2>Ablauf in E-Tax BL</h2><ol><li>Mit den Zugangsdaten (Ordner 01) in E-Tax BL anmelden, Vorjahresdaten übernehmen.</li>
<li>E-Steuerauszüge (Ordner 05) importieren, Crypto-Zeilen (Ordner 06) von Hand im Wertschriftenverzeichnis erfassen.</li>
<li>Werte dieser Tabelle Ziffer für Ziffer prüfen bzw. eintragen, PDF-Belege hochladen.</li><li>Einreichen, eingereichte Erklärung als PDF in Finance Vault ablegen (Archiv).</li></ol>
<p class="mut">Ziffern und Pauschalen wie in deinen Erklärungen 2022/2023 (E-Tax BL). Beträge jährlich in der Wegleitung prüfen. Organisationshilfe, keine Steuerberatung.</p></html>`;
}
export function reportCSV(y) {
  const items = mappe(y); const tot = totals(items);
  const L = [['Ziffer', 'Bezeichnung', 'Staat', 'Bund', 'Status', 'Belege'].join(';')];
  for (const i of items.filter((x) => x.ziffer && x.status !== 'nicht')) L.push([i.ziffer, i.label, i.value ? i.value.staat ?? '' : '', i.value ? i.value.bund ?? i.value.staat ?? '' : '', i.status, i.docs.map((d) => d.fileName).join(' | ')].map((x) => String(x).replace(/;/g, ',')).join(';'));
  for (const z of ['800', '300', '970', '971', '972']) L.push([z, 'Total (Wertschriftenverzeichnis)', tot[z], tot[z], '', ''].join(';'));
  return '﻿' + L.join('\n');
}
export async function buildPackage(y) {
  const s = S(); const t = s.taxYears[y] || { rates: {}, checklist: {} };
  const items = mappe(y); const files = []; const used = new Set();
  const put = async (folder, d, label) => {
    if (!d.file || used.has(d.id)) return; used.add(d.id);
    const f = await fileBytes(d.file); if (f) files.push({ name: `${folder}/${safe(label || d.title || d.fileName)}_${d.id.slice(-4)}${ext(f)}`, data: f.bytes });
  };
  for (const i of items) for (const d of i.docs) await put(FOLDER[i.area] || '08_Weitere', d, d.title);
  // Crypto-Bericht
  const snap = t.closed ? t.snapshot : null;
  const hold = snap ? snap.holdings : Object.values(yearEndHoldings(y)).filter((x) => x.qty > 1e-8).map((x) => ({ asset: x.asset, qty: x.qty }));
  const rates = snap ? snap.rates : t.rates || {}; let total = 0;
  const lines = ['Code;Asset;Bestand 31.12.' + y + ';Steuerkurs CHF;Steuerwert CHF;Kursquelle'];
  hold.forEach((h) => { const r = rates[h.asset]; if (r && r.chf != null) total += h.qty * r.chf; lines.push(['KRY', h.asset, h.qty, r ? r.chf : '', r ? (h.qty * r.chf).toFixed(2) : '', r ? r.source : 'fehlt'].join(';')); });
  lines.push(`;Total;;;${total.toFixed(2)};`);
  if (hold.length) files.push({ name: `06_Krypto/Crypto_Steuerbericht_${y}.csv`, data: '﻿' + lines.join('\n') });
  // Rechnungen mit Steuerrelevanz (Weiterbildung, Gesundheit, Spenden, Abo)
  const inYear = (d) => d && new Date(d).getFullYear() === y;
  for (const i of s.invoices.filter((x) => x.tax !== 'no' && x.category !== 'Steuern' && inYear(x.paidAt || x.due) && x.file)) {
    const f = await fileBytes(i.file); if (f) files.push({ name: `07_Abzuege/${safe(i.ziffer ? 'Ziff' + i.ziffer + '_' : '')}${safe(i.issuer)}_${safe(i.number || i.id)}${ext(f)}`, data: f.bytes });
  }
  // Steuerrechnungen des Jahres
  for (const i of s.invoices.filter((x) => x.category === 'Steuern' && +x.taxYear === y && x.file)) {
    const f = await fileBytes(i.file); if (f) files.push({ name: `09_Steuerrechnungen/${safe(i.taxKind || 'Steuer')}_${safe(i.taxStage || '')}_${i.id.slice(-4)}${ext(f)}`, data: f.bytes });
  }
  // Übrige Dokumente des Jahres (Erklärung, Veranlagung, Nur-Ablage)
  for (const d of (s.documents || []).filter((x) => x.status !== 'inbox' && +x.year === y && !used.has(x.id))) {
    const folder = d.kind === 'erklaerung' ? '10_Eingereicht' : d.kind === 'veranlagung' ? '11_Veranlagung' : d.taxItem === 'info' ? '99_Nur_Ablage_nicht_noetig' : '08_Weitere';
    await put(folder, d, d.title);
  }
  // Vorjahres-Erklärung als Vorlage
  for (const d of (s.documents || []).filter((x) => x.kind === 'erklaerung' && +x.year === y - 1)) await put('00_Bericht/Vorjahr', d, `Steuererklaerung_${y - 1}`);
  files.unshift({ name: `00_Bericht/Eintragen_${y}.csv`, data: reportCSV(y) });
  files.unshift({ name: `00_Bericht/Steuern_${y}_Was_trage_ich_wo_ein.html`, data: reportHTML(y) });
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
