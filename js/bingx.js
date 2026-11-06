// =====================================================================
// bingx.js – BingX-Kontoauszüge (Bill/Statement-Export)
//
// BingX liefert pro Konto eine CSV (Spot_Account, Fund_Account,
// Futures, Wealth). Jede Zeile ist eine Saldo-Änderung mit neuem Saldo.
//  · Spot: ein Trade = 2 Zeilen mit gleicher Zeit (+ erhalten, - bezahlt)
//  · Fund: Einzahlungen, Auszahlungen (z. B. an den Ledger), Rebates
//  · "Spot Account -> Fund Account" = interne Umbuchung (ignoriert)
//
// Mit dem mitgelieferten Saldo prüft der Import jede Zeile. Fehlt
// Historie (z. B. Käufe vor dem Export-Zeitraum), entsteht eine Lücke:
//  · fehlende Gutschrift  -> Anfangsbestand ohne Kaufpreis (Ø fehlt)
//  · fehlende Abbuchung    -> bei Stablecoins Verkauf, sonst "Bitte zuordnen"
// So stimmen die Bestände immer, und es wird nie ein Preis erfunden.
// =====================================================================
import { S, uid } from './store.js';
import { parseCSV, num, parseDate } from './importer.js';
import { STABLE_USD, historicalCHF } from './prices.js';

const STABLE = new Set([...STABLE_USD]);
const TOL = 2e-8;

// ---------- Erkennung ----------
export function detect(headers) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const has = (x) => h.includes(x);
  const time = h.findIndex((x) => x.startsWith('time('));
  if (time < 0) return null;
  if (has('newavailableamount') && has('assets')) return has('futures') ? 'futures' : 'spot';
  if (has('new_available_amount') && has('asset_name')) return has('asset_lock_amount') ? 'wealth' : 'fund';
  return null;
}
export const ACCT_LABEL = { spot: 'Spot', fund: 'Fund', futures: 'Futures', wealth: 'Wealth' };

// ---------- Datei -> Rohzeilen ----------
export function parseFile(text, name = '') {
  const p = parseCSV(text);
  const acct = detect(p.headers);
  if (!acct) return null;
  const h = p.headers.map((x) => x.toLowerCase().trim());
  const ix = (...names) => h.findIndex((x) => names.includes(x));
  const iT = h.findIndex((x) => x.startsWith('time(')), tz = tzFromHeader(p.headers[iT]), iType = ix('type'), iAmt = ix('amount'),
    iBal = ix('newavailableamount', 'new_available_amount'), iAsset = ix('assets', 'asset_name'), iRem = ix('remark', 'details');
  const rows = [];
  for (const r of p.rows) {
    const amount = num(r[iAmt]); const bal = num(r[iBal]);
    if (amount == null || !r[iAsset] || !r[iT]) continue;
    const asset = r[iAsset].trim().toUpperCase();
    if (!/^[A-Z0-9.\-_]{1,20}$/.test(asset)) continue; // nur plausible Coin-Symbole
    rows.push({ acct, ts: r[iT], tz, type: (r[iType] || '').trim(), amount, bal: bal ?? null, asset, remark: iRem >= 0 ? (r[iRem] || '') : '' });
  }
  return { acct, name, rows, header: p.headers };
}

// Zeitzone aus der Kopfzeile: "Time(UTC+8)" -> +480 (Minuten),
// "Time(Europe/Berlin)" -> 'Europe/Berlin' (mit Sommerzeit). null = unbekannt (Gerätezeit).
function tzFromHeader(h) {
  const inner = (/time\(([^)]+)\)/i.exec(h || '') || [])[1] || '';
  const m = /utc\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i.exec(inner);
  if (m) return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0));
  if (/^utc$/i.test(inner.trim())) return 0;
  const zone = inner.trim();
  if (/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(zone)) { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone; } catch (e) { /* unbekannt */ } }
  return null;
}
// Lokale Uhrzeit in einer IANA-Zeitzone -> UTC-Millisekunden
function zonedUTC(y, mo, d, h, mi, se, zone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = (ms) => { const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms; };
  const guess = Date.UTC(y, mo, d, h, mi, se);
  return guess - off(guess - off(guess));
}

// Schlüssel OHNE Zeitzone, damit früher gespeicherte Rohzeilen weiter erkannt werden
export const rowKey = (r) => [r.acct, r.ts, r.type, r.asset, r.amount, r.bal].join('|');

// Rohzeilen zusammenführen (Duplikate weg). Ältere Zeilen ohne Zeitzone
// übernehmen sie aus dem neuen Import derselben Zeile.
export function mergeRaw(existing, incoming) {
  const map = new Map(existing.map((r) => [rowKey(r), { ...r }]));
  let added = 0;
  for (const r of incoming) {
    const k = rowKey(r); const old = map.get(k);
    if (!old) { map.set(k, r); added++; } else if (old.tz == null && r.tz != null) old.tz = r.tz;
  }
  return { rows: [...map.values()], added };
}

// ---------- Klassifizierung ----------
function kind(r) {
  const t = r.type.toLowerCase();
  if (/->|account transfer|internal|subscri|redeem|redemption|transfer (from|to) .*account|futures account/.test(t)) return 'internal';
  if (/withdraw/.test(t)) return 'withdraw';
  if (/deposit/.test(t)) return 'deposit';
  if (/rebate|reward|bonus|airdrop|interest|cashback|commission back|earn|yield|distribution/.test(t)) return 'reward';
  if (/(buy|sell)/.test(t) && (r.acct === 'spot')) return 'trade';
  if (/fee|funding/.test(t)) return 'fee';
  return 'other';
}
// Zeitstempel einer Zeile -> echtes Datum. Mit bekannter Zeitzone exakt (UTC-Rechnung),
// sonst wie bisher als Gerätezeit.
export function rowDate(r, offsetMs = 0) {
  const d = parseDate(r.ts); if (!d) return null;
  if (r.tz == null) return new Date(d.getTime() + offsetMs);
  const c = [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
  const utc = typeof r.tz === 'string' ? zonedUTC(...c, r.tz) : Date.UTC(...c) - r.tz * 60e3;
  return new Date(utc + offsetMs);
}
const short = (s) => (s && s.length > 10 ? '…' + s.slice(-6) : s || '');
const addr = (remark) => { const m = /address:\s*(\S+)/i.exec(remark || ''); return m ? m[1] : ''; };

// ---------- Rohzeilen -> Ereignisse (inkl. Saldo-Lücken) ----------
export function analyse(rows) {
  const byAcct = {};
  for (const r of rows) (byAcct[r.acct] ||= []).push(r);
  const events = []; const balances = {}; const gaps = [];
  for (const [acct, list] of Object.entries(byAcct)) {
    list.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : b.amount - a.amount));
    const run = {};
    for (const r of list) {
      const prior = r.bal != null ? r.bal - r.amount : null;
      const cur = run[r.asset] || 0;
      if (prior != null && Math.abs(prior - cur) > TOL + Math.abs(prior) * 1e-9) {
        const g = { acct, asset: r.asset, ts: r.ts, tz: r.tz, gap: +(prior - cur).toFixed(10) };
        gaps.push(g); events.push({ k: 'gap', ...g });
      }
      run[r.asset] = r.bal != null ? r.bal : cur + r.amount;
    }
    for (const [a, v] of Object.entries(run)) balances[a] = (balances[a] || 0) + v;
  }
  // Trades paaren (gleiche Zeit im Spot-Konto)
  const tradeLegs = {};
  for (const r of rows) {
    const k = kind(r);
    if (k === 'internal') continue;
    if (k === 'trade') { (tradeLegs[r.acct + '|' + r.ts] ||= []).push(r); continue; }
    events.push({ k, r, ts: r.ts });
  }
  for (const legs of Object.values(tradeLegs)) {
    const pos = legs.filter((l) => l.amount > 0), neg = legs.filter((l) => l.amount < 0);
    if (pos.length === 1 && neg.length === 1) events.push({ k: 'swap', ts: pos[0].ts, tz: pos[0].tz, recv: pos[0], give: neg[0], recurring: /recurring/i.test(pos[0].type) });
    else legs.forEach((l) => events.push({ k: 'other', r: l, ts: l.ts }));
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.k === 'gap' ? -1 : 0) - (b.k === 'gap' ? -1 : 0)));
  return { events, balances, gaps };
}

// ---------- Ereignisse -> Transaktionen (mit CHF-Bewertung) ----------
export async function build(rows, progress = () => {}) {
  // Ausgeblendete Coins (z. B. VST = BingX-Demo-Guthaben) gar nicht erst verarbeiten
  const hidden = new Set(S().settings.ignoredAssets || []);
  rows = rows.filter((r) => !hidden.has(r.asset));
  const { events, balances, gaps } = analyse(rows);
  const wallet = S().settings.defaultWallet || 'Ledger';
  const txs = []; let seq = 0; let missingChf = 0;
  const rate = async (asset, ev) => (asset === 'CHF' ? 1 : historicalCHF(asset, rowDate(ev)));
  const push = (o) => txs.push({ id: uid(), platform: 'BingX', fee: 0, note: '', seq: seq++, ...o });
  const stats = { swaps: 0, recurring: 0, recurringSpent: {}, deposits: 0, withdrawals: 0, rewards: 0, review: 0, missingHistory: {}, stableGaps: {} };

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    progress(i + 1, events.length);
    if (e.k === 'swap') {
      const { recv, give } = e;
      const ra = Math.abs(recv.amount), ga = Math.abs(give.amount);
      let v = null;
      if (STABLE.has(give.asset)) { const x = await rate(give.asset, e); if (x != null) v = ga * x; }
      else if (STABLE.has(recv.asset)) { const x = await rate(recv.asset, e); if (x != null) v = ra * x; }
      else { const x = await rate(recv.asset, e); if (x != null) v = ra * x; else { const y = await rate(give.asset, e); if (y != null) v = ga * y; } }
      if (v == null) missingChf++;
      const chf = v != null ? +v.toFixed(2) : null;
      const note = e.recurring ? 'Sparplan BingX' : 'Handel BingX';
      push({ type: 'buy', asset: recv.asset, amount: ra, chf, date: rowDate(e).toISOString(), note: `${note}: ${fmt(ga)} ${give.asset} → ${fmt(ra)} ${recv.asset}`, extId: 'bingx:' + rowKey(recv) });
      push({ type: 'sell', asset: give.asset, amount: ga, chf, date: rowDate(e).toISOString(), note: `${note}: bezahlt für ${recv.asset}`, extId: 'bingx:' + rowKey(give) });
      stats.swaps++;
      if (e.recurring) { stats.recurring++; stats.recurringSpent[give.asset] = (stats.recurringSpent[give.asset] || 0) + ga; }
      continue;
    }
    if (e.k === 'gap') {
      const d = rowDate(e, -1000).toISOString();
      const id = `bingx:gap|${e.acct}|${e.ts}|${e.asset}|${e.gap}`;
      if (STABLE.has(e.asset)) {
        const x = await rate(e.asset, e);
        const chf = x != null ? +(Math.abs(e.gap) * x).toFixed(2) : null;
        push({ type: e.gap > 0 ? 'buy' : 'sell', asset: e.asset, amount: Math.abs(e.gap), chf, date: d, extId: id,
          note: e.gap > 0 ? 'Fehlende Gutschrift im Export (bewertet zum Tageskurs)' : 'Fehlende Abbuchung im Export (Handel ausserhalb des Export-Zeitraums)' });
        stats.stableGaps[e.asset] = (stats.stableGaps[e.asset] || 0) + e.gap;
      } else if (e.gap > 0) {
        push({ type: 'opening', asset: e.asset, amount: e.gap, chf: null, date: d, extId: id,
          note: 'Bestand ohne Kaufhistorie (Kauf nicht im Export). Ältere Spot-Handelshistorie importieren oder Kauf ergänzen.' });
        stats.missingHistory[e.asset] = (stats.missingHistory[e.asset] || 0) + e.gap;
      } else {
        push({ type: 'review', dir: 'out', asset: e.asset, amount: -e.gap, chf: null, date: d, extId: id, raw: `Fehlende Abbuchung ${fmt(-e.gap)} ${e.asset} (${ACCT_LABEL[e.acct]})`,
          note: 'Saldo im Export tiefer als erwartet: Verkauf, Gebühr oder Transfer?' });
        stats.review++;
      }
      continue;
    }
    const r = e.r; const amt = Math.abs(r.amount); const d = rowDate(r).toISOString(); const id = 'bingx:' + rowKey(r);
    switch (e.k) {
      case 'withdraw':
        push({ type: 'transfer', asset: r.asset, amount: amt, chf: 0, date: d, to: wallet, extId: id, note: `Auszahlung an ${short(addr(r.remark))}` });
        stats.withdrawals++; break;
      case 'deposit':
        if (STABLE.has(r.asset)) {
          const x = await rate(r.asset, r);
          push({ type: 'buy', asset: r.asset, amount: amt, chf: x != null ? +(amt * x).toFixed(2) : null, date: d, extId: id, note: 'Einzahlung Stablecoin (bewertet zum Tageskurs)' });
          if (x == null) missingChf++;
        } else {
          push({ type: 'review', dir: 'in', asset: r.asset, amount: amt, chf: null, date: d, extId: id, raw: `Einzahlung ${fmt(amt)} ${r.asset} von ${short(addr(r.remark))}`,
            note: 'Eigener Transfer (Kauf schon anderswo erfasst) oder Anfangsbestand?' });
          stats.review++;
        }
        stats.deposits++; break;
      case 'reward':
        push({ type: 'reward', asset: r.asset, amount: amt, chf: 0, date: d, extId: id, note: r.type });
        stats.rewards++; break;
      case 'fee':
        if (r.amount < 0) push({ type: 'fee', asset: r.asset, amount: amt, chf: 0, date: d, extId: id, note: r.type });
        else push({ type: 'review', dir: 'in', asset: r.asset, amount: amt, chf: null, date: d, extId: id, raw: `${r.type} +${fmt(amt)} ${r.asset}` });
        break;
      default:
        push({ type: 'review', dir: r.amount > 0 ? 'in' : 'out', asset: r.asset, amount: amt, chf: null, date: d, extId: id, raw: `${ACCT_LABEL[r.acct]}: ${r.type} ${r.amount > 0 ? '+' : ''}${fmt(r.amount)} ${r.asset}` });
        stats.review++;
    }
  }
  const gapDates = gaps.map((g) => g.ts).sort();
  stats.gapFrom = gapDates[0] || null; stats.gapTo = gapDates[gapDates.length - 1] || null;
  const dates = rows.map((r) => r.ts).sort();
  const ms = rows.map((r) => rowDate(r)).filter(Boolean).map((d) => d.getTime());
  return { txs, balances, gaps, stats, missingChf, from: dates[0], to: dates[dates.length - 1], toMs: ms.length ? Math.max(...ms) : null };
}

const fmt = (v) => String(+Number(v).toFixed(8));

// ---------- In den Zustand übernehmen ----------
// Alle BingX-Transaktionen werden aus den gesammelten Rohzeilen neu erzeugt.
// Bereits von dir zugeordnete Einträge (decided) bleiben erhalten.
export function apply(result) {
  const s = S();
  const decided = new Map(s.transactions.filter((t) => t.decided && String(t.extId).startsWith('bingx:')).map((t) => [t.extId, t]));
  const deleted = s.deletedExt || {};
  const cut = result.toMs || (result.to ? new Date(String(result.to).replace(' ', 'T')).getTime() : 0);
  // Statement ersetzt alle bisherigen Auszug-Buchungen und API-Trades bis zum Auszugsende
  s.transactions = s.transactions.filter((t) => {
    const id = String(t.extId || '');
    if (id.startsWith('bingx:')) return false;
    if (id.startsWith('bingxapi:') && new Date(t.date).getTime() <= cut) return false;
    return true;
  });
  for (const t of result.txs) {
    if (deleted[t.extId]) continue; // von dir gelöscht -> bleibt gelöscht
    s.transactions.push(decided.has(t.extId) ? { ...decided.get(t.extId), seq: t.seq } : t);
  }
}
