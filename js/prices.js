// =====================================================================
// prices.js – Crypto-Kurse via CoinGecko (CHF)
// Live beim Öffnen, regelmässig während die App offen ist,
// offline: letzter bekannter Kurs bleibt erhalten.
// Historische Kurse: eine Tagesreihe pro Coin (spart Abfragen).
// =====================================================================
import { S, commit } from './store.js';

const API = 'https://api.coingecko.com/api/v3';

export const KNOWN = {
  BTC: 'bitcoin', ETH: 'ethereum', XRP: 'ripple', SOL: 'solana', LINK: 'chainlink', KAS: 'kaspa',
  AVAX: 'avalanche-2', NEAR: 'near', SEI: 'sei-network', SUI: 'sui', ONDO: 'ondo-finance', VET: 'vechain',
  HYPE: 'hyperliquid', USDT: 'tether', USDC: 'usd-coin', ADA: 'cardano', HBAR: 'hedera-hashgraph',
  QNT: 'quant-network', SAND: 'the-sandbox', VRA: 'verasity', DOT: 'polkadot', ATOM: 'cosmos', KTA: 'keeta',
  BNB: 'binancecoin', DOGE: 'dogecoin', TRX: 'tron', LTC: 'litecoin', POL: 'polygon-ecosystem-token',
};
export const FIAT = ['CHF', 'USD', 'EUR'];
export const STABLE_USD = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD'];

function url(path, params = {}) {
  const k = S().settings.cgKey;
  if (k) params.x_cg_demo_api_key = k;
  const q = new URLSearchParams(params).toString();
  return `${API}${path}${q ? '?' + q : ''}`;
}

export function coinId(sym) { const c = S().coins[sym]; return (c && c.id) || KNOWN[sym] || null; }

export async function resolveId(sym) {
  if (coinId(sym)) return coinId(sym);
  try {
    const j = await getJSON(url('/search', { query: sym }));
    const hit = (j.coins || []).find((c) => c.symbol.toUpperCase() === sym.toUpperCase());
    // auto: nur per Symbol gefunden – kann ein Namensvetter sein. Bis zur Bestätigung im
    // Coin-Detail zählt der Coin nicht für Meilensteine.
    if (hit) { S().coins[sym] = { ...(S().coins[sym] || {}), id: hit.id, name: hit.name, auto: true }; commit(true); return hit.id; }
  } catch (e) { /* offline */ }
  return null;
}

let busy = false;
export async function refreshPrices(symbols) {
  if (busy) return { ok: false, reason: 'busy' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };
  busy = true;
  try {
    const syms = [...new Set(symbols)].filter((x) => !FIAT.includes(x));
    for (const s of syms) if (!coinId(s)) await resolveId(s);
    const ids = [...new Set(syms.map(coinId).filter(Boolean))];
    if (!ids.length) return { ok: true };
    const r = await cgFetch(url('/simple/price', { ids: ids.join(','), vs_currencies: 'chf', include_24hr_change: 'true' }));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const now = new Date().toISOString();
    for (const s of syms) {
      const d = j[coinId(s)];
      if (d && d.chf != null) S().prices[s] = { chf: d.chf, change24h: d.chf_24h_change ?? null, at: now };
    }
    S().pricesAt = now;
    commit();
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; } finally { busy = false; }
}

// ---------- Historische Kurse ----------
// CoinGecko gratis erlaubt nur wenige Abfragen pro Minute (ohne Schlüssel ca. 5–10,
// mit kostenlosem Demo-Schlüssel 30). Darum:
//  · alle CoinGecko-Abfragen laufen nacheinander mit Mindestabstand (Warteschlange)
//  · bei «429 Too Many Requests» wird gewartet (Retry-After bzw. 20/40/60 s)
//  · geladene Tagesreihen werden im (verschlüsselten) Vault zwischengespeichert,
//    damit ein zweiter Versuch nur noch Fehlendes holt.
const series = {};   // id -> Promise<[[ms, chf], ...]>
const single = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notifyWait = (sec) => dispatchEvent(new CustomEvent('cgwait', { detail: { sec } }));

let queue = Promise.resolve(); let lastCall = 0;
function cgFetch(u) {
  const run = async () => {
    const gap = S().settings.cgKey ? 2200 : 7000;
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    for (let tries = 0; ; tries++) {
      lastCall = Date.now();
      const r = await fetch(u);
      if (r.status !== 429 || tries >= 3) return r;
      const ra = Number(r.headers.get('retry-after'));
      const sec = Number.isFinite(ra) && ra > 0 && ra <= 120 ? ra : 20 * (tries + 1);
      notifyWait(sec); await sleep(sec * 1000);
    }
  };
  const p = queue.then(run, run); queue = p.catch(() => {}); return p;
}

async function getJSON(u) {
  const r = u.startsWith(API) ? await cgFetch(u) : await fetch(u);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Tagesreihe der letzten 365 Tage (kostenloser Zugang erlaubt max. 365 Tage)
const cache = () => (S().histCache ||= {});
function dailySeries(id, t) {
  const c = cache()[id];
  // Zwischenspeicher gilt, wenn er jünger als 12 h ist oder das Datum klar vor dem Abruf liegt
  if (c && (Date.now() - c.at < 12 * 36e5 || t < c.at - 864e5)) return Promise.resolve(c.p);
  if (!series[id]) {
    series[id] = getJSON(url(`/coins/${id}/market_chart`, { vs_currency: 'chf', days: '365', interval: 'daily' }))
      .then((j) => {
        const p = (j.prices || []).map(([ms, v]) => [ms, +Number(v).toPrecision(8)]);
        if (p.length) { cache()[id] = { at: Date.now(), p }; commit(true); }
        return p;
      }).catch(() => (c ? c.p : []))
      .finally(() => { delete series[id]; });
  }
  return series[id];
}

// ---------- USD/CHF (EZB-Referenzkurs via Frankfurter, ohne Schlüssel) ----------
// Für Stablecoins (USDT, USDC …) gilt 1 Stablecoin ≈ 1 USD. Der EZB-Kurs ist
// offiziell, kostenlos und hat – anders als CoinGecko gratis – keine 1-Jahres-Grenze.
const FX = 'https://api.frankfurter.dev/v1';
const fxYears = {};
function fxYear(y) {
  if (!fxYears[y]) {
    fxYears[y] = getJSON(`${FX}/${y}-01-01..${y}-12-31?base=USD&symbols=CHF`)
      .then((j) => Object.entries(j.rates || {}).map(([d, r]) => [d, r.CHF]).filter(([, v]) => v > 0).sort())
      .catch(() => { delete fxYears[y]; return []; });
  }
  return fxYears[y];
}
export async function usdChf(date) {
  const d = new Date(date); const day = d.toISOString().slice(0, 10);
  let list = await fxYear(d.getUTCFullYear());
  if (!list.length || list[0][0] > day) list = [...(await fxYear(d.getUTCFullYear() - 1)), ...list];
  let best = null;
  for (const [k, v] of list) { if (k <= day) best = v; else break; } // letzter Handelstag vor/an dem Datum
  return best;
}

export async function historicalCHF(sym, date) {
  if (sym === 'CHF') return 1;
  if (STABLE_USD.includes(sym)) { const fx = await usdChf(date).catch(() => null); if (fx != null) return fx; }
  const id = coinId(STABLE_USD.includes(sym) && !KNOWN[sym] ? 'USDT' : sym) || (await resolveId(sym));
  if (!id) return null;
  const t = new Date(date).getTime();
  if (Date.now() - t < 364 * 864e5) {
    const arr = await dailySeries(id, t);
    if (arr.length) {
      let best = null, bd = Infinity;
      for (const [ms, v] of arr) { const d = Math.abs(ms - t); if (d < bd) { bd = d; best = v; } }
      if (bd < 2 * 864e5) return best;
    }
  }
  // Fallback: Einzelabfrage (älter als 1 Jahr)
  const d = new Date(date);
  const ds = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const key = id + ds;
  if (!(key in single)) {
    single[key] = getJSON(url(`/coins/${id}/history`, { date: ds, localization: 'false' }))
      .then((j) => (j.market_data && j.market_data.current_price ? j.market_data.current_price.chf : null)).catch(() => null)
      .then((v) => { if (v == null) delete single[key]; return v; });
  }
  return single[key];
}

// Kursverläufe für bestimmte Coins laden (für Grafiken), über die Warteschlange
export async function loadHistory(syms, onStep = () => {}) {
  let i = 0;
  for (const sym of syms) {
    onStep(++i, syms.length, sym);
    const id = coinId(STABLE_USD.includes(sym) && !KNOWN[sym] ? 'USDT' : sym) || (await resolveId(sym));
    if (id) await dailySeries(id, 0).catch(() => null);
  }
  commit(true);
}
