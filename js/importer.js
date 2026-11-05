// =====================================================================
// importer.js – CSV-Import (Relai, BingX und andere Plattformen)
// Flexibler Spalten-Zuordner, Typ-Erkennung, CHF-Umrechnung,
// Duplikaterkennung. Sobald echte Exporte vorliegen, werden die
// Vorlagen für Relai und BingX exakt angepasst.
// =====================================================================
import { S, uid } from './store.js';
import { FIAT, STABLE_USD, historicalCHF } from './prices.js';

// ---------- CSV lesen ----------
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = text.split('\n').slice(0, 10).join('\n');
  const delim = [';', ',', '\t'].map((d) => [d, (first.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x !== ''));
  // Kopfzeile = erste Zeile mit der häufigsten Spaltenanzahl
  const counts = {}; clean.forEach((r) => { counts[r.length] = (counts[r.length] || 0) + 1; });
  const mode = +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const hi = clean.findIndex((r) => r.length === mode);
  const headers = clean[hi].map((h, i) => h || `Spalte ${i + 1}`);
  const data = clean.slice(hi + 1).filter((r) => r.length >= Math.min(mode, 2));
  return { headers, rows: data, delim };
}

// ---------- Zahlen & Datum ----------
export function num(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const neg = /^-|\(-?/.test(s) || /-\s*$/.test(s);
  s = s.replace(/[^\d.,'’eE+-]/g, '').replace(/['’]/g, '').replace(/^[+-]/, '');
  if (!s || !/\d/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function parseDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{10}(\d{3})?$/.test(s)) return new Date(s.length === 10 ? +s * 1000 : +s);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) && s.includes('T')) { const d = new Date(s); if (!isNaN(d)) return d; }
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    let a = +m[1], b = +m[2]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    let day = a, mon = b;
    if (s.includes('/') && a <= 12 && b > 12) { day = b; mon = a; }
    return new Date(y, mon - 1, day, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ---------- Spalten-Zuordnung ----------
export const ROLES = [
  ['date', 'Datum'], ['type', 'Typ / Richtung'], ['pair', 'Handelspaar (z. B. LINK-USDT)'], ['asset', 'Coin'],
  ['amount', 'Menge Coin'], ['quote', 'Gegenwährung'], ['total', 'Gesamtbetrag (Gegenwährung)'], ['price', 'Preis pro Coin'],
  ['chf', 'Betrag in CHF'], ['fee', 'Gebühr'], ['feeAsset', 'Gebühr-Währung'], ['txid', 'Transaktions-ID'],
];
const KEYS = {
  feeAsset: ['fee coin', 'fee asset', 'fee currency', 'gebühr währung', 'fee unit'],
  fee: ['fee', 'gebühr', 'commission', 'kommission'],
  txid: ['order id', 'orderid', 'txid', 'tx id', 'transaction id', 'trade id', 'reference', 'referenz', 'hash', 'id'],
  date: ['date', 'datum', 'time', 'zeit', 'created', 'timestamp'],
  type: ['type', 'typ', 'side', 'richtung', 'operation', 'art', 'direction', 'action'],
  pair: ['pair', 'symbol', 'market', 'paar', 'instrument'],
  chf: ['chf'],
  quote: ['quote currency', 'quote asset', 'gegenwährung', 'settlement'],
  price: ['price', 'preis', 'kurs', 'rate'],
  total: ['total', 'volume', 'turnover', 'betrag', 'summe', 'value', 'filled value', 'quote'],
  amount: ['amount', 'menge', 'quantity', 'qty', 'executed', 'filled', 'anzahl', 'size', 'btc'],
  asset: ['coin', 'asset', 'crypto', 'currency', 'währung', 'token'],
};
export function guessMapping(headers) {
  const map = {}; const used = new Set();
  for (const role of Object.keys(KEYS)) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i].toLowerCase();
      if (KEYS[role].some((k) => (k === 'id' ? /(^|\W)id($|\W)/.test(h) : h.includes(k)))) { map[role] = i; used.add(i); break; }
    }
  }
  return map;
}

export function detectType(text, amountSign) {
  const t = (text || '').toLowerCase();
  if (/(reward|staking|earn|interest|airdrop|bonus|cashback|zins|distribution)/.test(t)) return 'reward';
  if (/(fee|gebühr|commission)/.test(t) && !/(buy|sell|kauf)/.test(t)) return 'fee';
  if (/(sell|verkauf|sold)/.test(t)) return 'sell';
  if (/(buy|kauf|bought|purchase|sparplan|savings|dca)/.test(t)) return 'buy';
  if (/(withdraw|auszahlung|send|gesendet|outgoing)/.test(t)) return 'withdraw';
  if (/(deposit|einzahlung|receive|empfangen|incoming)/.test(t)) return 'deposit';
  if (/(transfer|übertrag)/.test(t)) return 'transfer';
  if (!text && amountSign) return amountSign > 0 ? 'buy' : 'sell';
  return 'review';
}

const cleanSym = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function splitPair(p) {
  const s = String(p || '').toUpperCase().trim();
  let m = s.match(/^([A-Z0-9]+)[-/_ ]([A-Z0-9]+)$/);
  if (m) return [m[1], m[2]];
  for (const q of ['USDT', 'USDC', 'FDUSD', 'CHF', 'USD', 'EUR', 'BTC', 'ETH']) if (s.endsWith(q) && s.length > q.length) return [s.slice(0, -q.length), q];
  return [cleanSym(s), null];
}

async function hashRow(platform, row) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(platform + '|' + row.join('|')));
  return Array.from(new Uint8Array(b).slice(0, 12)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Zeilen -> Roh-Datensätze (noch ohne CHF-Umrechnung) ----------
export async function interpret(parsed, mapping, opts) {
  const { platform, defaultQuote = 'CHF', defaultAsset = '' } = opts;
  const g = (row, role) => (mapping[role] != null && mapping[role] !== '' ? row[mapping[role]] : undefined);
  const out = []; let errors = 0;
  for (const row of parsed.rows) {
    const date = parseDate(g(row, 'date'));
    let [asset, quote] = g(row, 'pair') ? splitPair(g(row, 'pair')) : [null, null];
    if (g(row, 'asset')) asset = cleanSym(g(row, 'asset'));
    asset = asset || cleanSym(defaultAsset);
    if (g(row, 'quote')) quote = cleanSym(g(row, 'quote'));
    quote = quote || cleanSym(defaultQuote);
    const rawAmount = num(g(row, 'amount'));
    let total = num(g(row, 'total'));
    const price = num(g(row, 'price'));
    const chf = num(g(row, 'chf'));
    const fee = num(g(row, 'fee'));
    const feeAsset = cleanSym(g(row, 'feeAsset')) || null;
    const typeText = g(row, 'type') || '';
    if (!date || !asset || rawAmount == null || rawAmount === 0) { errors++; continue; }
    const amount = Math.abs(rawAmount);
    if (total == null && price != null) total = price * amount;
    const kind = detectType(typeText, Math.sign(rawAmount));
    const extId = (g(row, 'txid') ? platform + ':' + g(row, 'txid') + ':' + asset + ':' + kind : 'h:' + (await hashRow(platform, row)));
    out.push({ date, asset, quote, amount, total: total != null ? Math.abs(total) : null, chf: chf != null ? Math.abs(chf) : null,
      fee: fee != null ? Math.abs(fee) : 0, feeAsset, kind, typeText, extId, raw: row.join(' | ') });
  }
  return { records: out, errors };
}

// ---------- Vorschau mit Duplikat-Zählung ----------
export function preview(records) {
  const existing = new Set(S().transactions.map((t) => t.extId).filter(Boolean));
  const seen = new Set(); let dup = 0; const fresh = [];
  for (const r of records) {
    if (existing.has(r.extId) || seen.has(r.extId)) { dup++; continue; }
    seen.add(r.extId); fresh.push(r);
  }
  return { fresh, dup, review: fresh.filter((r) => r.kind === 'review').length };
}

// ---------- Datensätze -> Transaktionen (mit CHF-Umrechnung) ----------
export async function toTransactions(records, opts, progress = () => {}) {
  const { platform, trackQuote = true, wallet = S().settings.defaultWallet } = opts;
  const txs = []; let missing = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    progress(i + 1, records.length);
    const base = { platform, date: r.date.toISOString(), note: r.typeText ? `Import: ${r.typeText}` : 'Import' };
    // CHF-Wert bestimmen
    let chf = r.chf;
    let rate = null;
    if (chf == null && r.total != null) {
      if (r.quote === 'CHF') chf = r.total;
      else { rate = await historicalCHF(STABLE_USD.includes(r.quote) ? 'USDT' : r.quote, r.date); if (rate != null) chf = r.total * rate; }
    }
    if (chf == null && ['buy', 'sell'].includes(r.kind)) missing++;
    // Gebühr in CHF bzw. als Coin-Abzug
    let feeChf = 0; const feeTx = [];
    if (r.fee) {
      if (!r.feeAsset || r.feeAsset === 'CHF') feeChf = r.fee;
      else if (r.feeAsset === r.quote) feeChf = rate != null ? r.fee * rate : r.quote === 'CHF' ? r.fee : 0;
      else feeTx.push({ ...base, id: uid(), type: 'fee', asset: r.feeAsset, amount: r.fee, chf: 0, extId: r.extId + ':fee' });
    }
    const t = { ...base, id: uid(), asset: r.asset, amount: r.amount, chf: chf != null ? +chf.toFixed(2) : null, fee: +feeChf.toFixed(4), extId: r.extId };
    switch (r.kind) {
      case 'buy': case 'sell': case 'reward': t.type = r.kind; break;
      case 'deposit': t.type = 'transfer'; t.to = platform; t.chf = 0; break;
      case 'withdraw': t.type = 'transfer'; t.to = wallet; t.chf = 0; break;
      case 'transfer': t.type = 'transfer'; t.chf = 0; break;
      case 'fee': t.type = 'fee'; t.chf = feeChf || 0; t.fee = 0; break;
      default: t.type = 'review'; t.raw = r.raw; t.suggest = r.total != null ? `${r.quote} ${r.total}` : '';
    }
    txs.push(t, ...feeTx);
    // Gegenseite mitführen (z. B. USDT, das für LINK ausgegeben wurde)
    if (trackQuote && ['buy', 'sell'].includes(r.kind) && r.total != null && !FIAT.includes(r.quote)) {
      txs.push({ ...base, id: uid(), type: r.kind === 'buy' ? 'sell' : 'buy', asset: r.quote, amount: r.total,
        chf: t.chf, fee: 0, extId: r.extId + ':quote', note: `Gegenseite ${r.kind === 'buy' ? 'Kauf' : 'Verkauf'} ${r.asset}` });
    }
  }
  return { txs, missing };
}
