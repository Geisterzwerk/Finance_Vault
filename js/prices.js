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
    const j = await (await fetch(url('/search', { query: sym }))).json();
    const hit = (j.coins || []).find((c) => c.symbol.toUpperCase() === sym.toUpperCase());
    if (hit) { S().coins[sym] = { ...(S().coins[sym] || {}), id: hit.id, name: hit.name }; commit(true); return hit.id; }
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
    const r = await fetch(url('/simple/price', { ids: ids.join(','), vs_currencies: 'chf', include_24hr_change: 'true' }));
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
const series = {};   // id -> Promise<[[ms, chf], ...]>
const single = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(u, tries = 0) {
  const r = await fetch(u);
  if (r.status === 429 && tries < 4) { await sleep(4000 * (tries + 1)); return getJSON(u, tries + 1); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Tagesreihe der letzten 365 Tage (kostenloser Zugang erlaubt max. 365 Tage)
function dailySeries(id) {
  if (!series[id]) {
    series[id] = getJSON(url(`/coins/${id}/market_chart`, { vs_currency: 'chf', days: '365', interval: 'daily' }))
      .then((j) => j.prices || []).catch(() => { delete series[id]; return []; });
  }
  return series[id];
}

export async function historicalCHF(sym, date) {
  if (sym === 'CHF') return 1;
  const id = coinId(STABLE_USD.includes(sym) && !KNOWN[sym] ? 'USDT' : sym) || (await resolveId(sym));
  if (!id) return null;
  const t = new Date(date).getTime();
  if (Date.now() - t < 364 * 864e5) {
    const arr = await dailySeries(id);
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
      .then((j) => (j.market_data && j.market_data.current_price ? j.market_data.current_price.chf : null)).catch(() => null);
  }
  return single[key];
}
