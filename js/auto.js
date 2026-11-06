// =====================================================================
// auto.js – Automatisches Zuordnen und Abgleichen
//
//  · ownAddresses()   deine öffentlichen Ledger-Adressen (aus Vault › Ledger)
//  · applyFunding()   BingX-Ein-/Auszahlungen vom Server als Transaktionen:
//        Auszahlung an eigene Adresse        -> Transfer (Bestand bleibt)
//        Auszahlung an fremde Adresse        -> «Bitte zuordnen» (Zahlung? Verkauf?)
//        Einzahlung Stablecoin               -> Kauf zum EZB-Tageskurs
//        Einzahlung von eigener Adresse      -> Transfer (automatisch erkannt)
//        Einzahlung von fremder Adresse      -> «Bitte zuordnen»
//  · autoResolve()    prüft offene Einzahlungen (auch aus CSV-Importen) erneut
//  · reconcile()      App-Bestand = Ledger + BingX? je Coin
//
// Absender-Abfrage: öffentliche Blockchain-Schnittstellen, nur die Transaktions-ID
// wird gesendet. Nichts wird erraten – ohne eindeutigen Treffer bleibt es eine Frage.
// =====================================================================
import { S, uid } from './store.js';
import { holdings, hiddenAssets } from './calc.js';
import { historicalCHF, STABLE_USD } from './prices.js';
import * as BX from './bingx.js';

const norm = (a) => String(a || '').trim().toLowerCase();

export function ownAddresses() {
  const m = new Map();
  for (const a of S().ledger.addresses || []) {
    for (const x of String(a.address).split(/[,\s]+/).filter(Boolean)) m.set(norm(x), { chain: a.chain, label: a.label || 'Ledger' });
  }
  return m;
}
// BingX hängt bei XRP u. a. Memo/Tag an («rP5…_1234») – für den Vergleich weglassen
const baseAddr = (a) => norm(a).replace(/[_:]\d+$/, '');
const isOwn = (own, a) => own.has(norm(a)) || own.has(baseAddr(a));

// ---------- Absender einer Transaktion (öffentliche Schnittstellen) ----------
const J = async (url, body) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, referrerPolicy: 'no-referrer', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
  } finally { clearTimeout(t); }
};
const rpc = (url, method, params) => J(url, { jsonrpc: '2.0', id: 1, method, params }).then((j) => j.result);
const EVM = ['https://ethereum-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc', 'https://rpc.hyperliquid.xyz/evm'];

export async function senders(coin, txid) {
  const id = String(txid || '').trim(); if (!id) return [];
  try {
    if (/^0x[0-9a-fA-F]{64}$/.test(id)) {
      for (const u of EVM) { const t = await rpc(u, 'eth_getTransactionByHash', [id]).catch(() => null); if (t && t.from) return [t.from]; }
      return [];
    }
    if (/^[0-9a-fA-F]{64}$/.test(id)) {
      if (coin === 'XRP') { const r = await J('https://xrplcluster.com', { method: 'tx', params: [{ transaction: id }] }); return r.result && r.result.Account ? [r.result.Account] : []; }
      if (coin === 'SEI') { const r = await J(`https://rest.sei-apis.com/cosmos/tx/v1beta1/txs/${id}`); const m = ((r.tx || {}).body || {}).messages || []; return m.map((x) => x.from_address).filter(Boolean); }
      if (coin === 'BTC') { const r = await J(`https://mempool.space/api/tx/${id}`); return (r.vin || []).map((v) => v.prevout && v.prevout.scriptpubkey_address).filter(Boolean); }
      return [];
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(id)) {
      if (coin === 'SUI') { const t = await rpc('https://fullnode.mainnet.sui.io', 'sui_getTransactionBlock', [id, { showInput: true }]); return t && t.transaction ? [t.transaction.data.sender] : []; }
      if (coin === 'SOL' || id.length > 60) { const t = await rpc('https://api.mainnet-beta.solana.com', 'getTransaction', [id, { maxSupportedTransactionVersion: 0, encoding: 'json' }]); const k = t && t.transaction && t.transaction.message.accountKeys; return k ? [typeof k[0] === 'string' ? k[0] : k[0].pubkey] : []; }
    }
  } catch (e) { /* offline oder unbekannt -> keine Aussage */ }
  return [];
}

// ---------- Ein-/Auszahlungen vom Server übernehmen ----------
export async function applyFunding({ deposits = [], withdrawals = [] }, cutoff = 0) {
  const s = S(); const own = ownAddresses(); const hidden = hiddenAssets();
  const have = new Set(s.transactions.map((t) => t.extId)); const del = s.deletedExt || {};
  const ok = (x) => x && /^[A-Z0-9]{1,20}$/.test(String(x.coin)) && Number.isFinite(+x.amount) && +x.amount > 0 && Number.isFinite(+x.time);
  let added = 0, auto = 0;
  for (const w of withdrawals) {
    const ext = 'bingxapi:' + w.id;
    if (!ok(w) || have.has(ext) || del[ext] || w.time <= cutoff || hidden.has(w.coin)) continue;
    const date = new Date(w.time).toISOString(); const mine = isOwn(own, w.address);
    if (mine || !own.size) {
      s.transactions.push({ id: uid(), extId: ext, type: 'transfer', asset: w.coin, amount: +w.amount, chf: 0, fee: 0, feeQty: +w.fee || 0, date, platform: 'BingX',
        to: mine ? own.get(norm(w.address))?.label || own.get(baseAddr(w.address))?.label || 'Ledger' : s.settings.defaultWallet || 'Ledger',
        txid: w.txId, address: w.address, note: mine ? 'Auszahlung an eigene Adresse (automatisch erkannt)' : 'Auszahlung' });
      if (mine) auto++;
    } else {
      s.transactions.push({ id: uid(), extId: ext, type: 'review', dir: 'out', asset: w.coin, amount: +w.amount, chf: null, fee: 0, date, platform: 'BingX', txid: w.txId, address: w.address,
        raw: `Auszahlung ${w.amount} ${w.coin} an …${String(w.address).slice(-8)}`, note: 'Adresse ist keine deiner Ledger-Adressen: Zahlung, Verkauf oder Transfer an ein anderes eigenes Konto?' });
    }
    added++;
  }
  for (const d of deposits) {
    const ext = 'bingxapi:' + d.id;
    if (!ok(d) || have.has(ext) || del[ext] || d.time <= cutoff || hidden.has(d.coin)) continue;
    const date = new Date(d.time).toISOString();
    if (STABLE_USD.includes(d.coin)) {
      const r = await historicalCHF(d.coin, date).catch(() => null);
      s.transactions.push({ id: uid(), extId: ext, type: 'buy', asset: d.coin, amount: +d.amount, chf: r != null ? +(r * d.amount).toFixed(2) : null, fee: 0, date, platform: 'BingX', txid: d.txId, note: 'Einzahlung Stablecoin (EZB-Tageskurs)' });
    } else {
      s.transactions.push({ id: uid(), extId: ext, type: 'review', dir: 'in', asset: d.coin, amount: +d.amount, chf: null, fee: 0, date, platform: 'BingX', txid: d.txId,
        raw: `Einzahlung ${d.amount} ${d.coin}`, note: 'Eigener Transfer oder Kauf anderswo?' });
    }
    added++;
  }
  auto += await autoResolve();
  return { added, auto };
}

// Offene Einzahlungen mit Transaktions-ID: Absender prüfen (je Eintrag nur einmal)
export async function autoResolve() {
  const s = S(); const own = ownAddresses(); if (!own.size || !navigator.onLine) return 0;
  let n = 0;
  for (const t of s.transactions) {
    if (t.type !== 'review' || t.dir !== 'in' || !t.txid || t.autoChecked) continue;
    t.autoChecked = new Date().toISOString();
    const from = await senders(t.asset, t.txid);
    const hit = from.find((a) => isOwn(own, a));
    if (hit) {
      Object.assign(t, { type: 'transfer', chf: 0, to: t.platform || 'BingX', decided: true, auto: true, note: `Eigener Transfer von ${own.get(norm(hit))?.label || 'Ledger'} (automatisch erkannt)` });
      delete t.raw; delete t.dir; n++;
    }
  }
  return n;
}

// ---------- Abgleich: App = Ledger + BingX ----------
export function reconcile() {
  const s = S(); const app = holdings(); const hidden = hiddenAssets();
  const L = s.ledger.last; const bxServer = s.server && s.server.bxBalances;
  let bx = {}; let bxSrc = null;
  if (bxServer && bxServer.assets && Date.now() - bxServer.at < 3 * 864e5) { bx = bxServer.assets; bxSrc = 'api'; }
  else if (s.raw.bingx && s.raw.bingx.length) { try { bx = BX.analyse(s.raw.bingx).balances; bxSrc = 'export'; } catch (e) { bx = {}; } }
  if (!L) return { ready: false, rows: [], bxSrc };
  const syms = [...new Set([...Object.keys(L.total || {}), ...Object.keys(app).filter((k) => app[k].qty > 1e-8)])].filter((k) => !hidden.has(k)).sort();
  const rows = syms.map((k) => {
    const lq = (L.total || {})[k] || 0, bq = Math.max(0, bx[k] || 0), aq = app[k] ? app[k].qty : 0;
    const diff = aq - lq - bq; const rel = Math.abs(diff) / Math.max(aq, lq + bq, 1e-12);
    const tracked = k in (L.total || {}) || bq > 0;
    return { k, lq, bq, aq, diff, tracked, ok: !tracked || rel < 0.005 || Math.abs(diff) < 1e-6 || (STABLE_USD.includes(k) && Math.abs(diff) < 1) };
  });
  return { ready: true, rows, bad: rows.filter((r) => !r.ok), at: L.at, bxSrc };
}

// ---------- Wertschriften-Positionen (Ticker × Stückzahl) ----------
export function updateSecurities() {
  const s = S(); const P = s.stockPrices || {}; let changed = 0;
  for (const a of s.accounts) {
    if (!Array.isArray(a.positions) || !a.positions.length) continue;
    if (!a.positions.every((p) => P[p.ticker] && P[p.ticker].chf > 0)) continue;
    const v = Math.round(a.positions.reduce((sum, p) => sum + p.qty * P[p.ticker].chf, 0) * 100) / 100;
    if (Math.abs(v - (Number(a.value) || 0)) < 0.01) continue;
    const sameDay = a.updated && new Date(a.updated).toDateString() === new Date().toDateString();
    if (!sameDay) a.history = [...(a.history || []), { at: a.updated, value: a.value }];
    a.value = v; a.updated = new Date().toISOString(); a.auto = true; changed++;
  }
  return changed;
}
