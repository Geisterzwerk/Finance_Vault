// =====================================================================
// prices.js – Crypto-Kurse via CoinGecko (CHF)
// Live beim Öffnen, regelmässig während die App offen ist,
// offline: letzter bekannter Kurs bleibt erhalten.
// =====================================================================
import { S, commit } from './store.js';

const API = 'https://api.coingecko.com/api/v3';

// Bekannte Symbole -> CoinGecko-IDs (bei Bedarf in der App änderbar)
export const KNOWN = {
  BTC: 'bitcoin', ETH: 'ethereum', XRP: 'ripple', SOL: 'solana', LINK: 'chainlink', KAS: 'kaspa',
  AVAX: 'avalanche-2', NEAR: 'near', SEI: 'sei-network', SUI: 'sui', ONDO: 'ondo-finance', VET: 'vechain',
  HYPE: 'hyperliquid', USDT: 'tether', USDC: 'usd-coin', ADA: 'cardano', HBAR: 'hedera-hashgraph',
  QNT: 'quant-network', SAND: 'the-sandbox', VRA: 'verasity', DOT: 'polkadot', ATOM: 'cosmos',
  BNB: 'binancecoin', DOGE: 'dogecoin', TRX: 'tron', LTC: 'litecoin', MATIC: 'matic-network', POL: 'polygon-ecosystem-token',
};
export const FIAT = ['CHF', 'USD', 'EUR'];
export const STABLE_USD = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD'];

function url(path, params = {}) {
  const k = S().settings.cgKey;
  if (k) params.x_cg_demo_api_key = k;
  const q = new URLSearchParams(params).toString();
  return `${API}${path}${q ? '?' + q : ''}`;
}

export function coinId(sym) {
  const c = S().coins[sym];
  return (c && c.id) || KNOWN[sym] || null;
}

// Unbekanntes Symbol über die Suche auflösen
export async function resolveId(sym) {
  if (coinId(sym)) return coinId(sym);
  try {
    const r = await fetch(url('/search', { query: sym }));
    const j = await r.json();
    const hit = (j.coins || []).find((c) => c.symbol.toUpperCase() === sym.toUpperCase());
    if (hit) {
      S().coins[sym] = { ...(S().coins[sym] || {}), id: hit.id, name: hit.name };
      commit(true);
      return hit.id;
    }
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
    const ids = syms.map(coinId).filter(Boolean);
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
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally { busy = false; }
}

// Historischer Kurs (CHF) an einem Datum – für Swaps ohne CHF-Wert und Steuer-Ersatzkurse
const histCache = {};
export async function historicalCHF(sym, date, tries = 0) {
  if (sym === 'CHF') return 1;
  const id = coinId(sym === 'USD' ? 'USDT' : sym) || (await resolveId(sym));
  if (!id) return null;
  const d = new Date(date);
  const ds = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const key = id + ds;
  if (key in histCache) return histCache[key];
  try {
    const r = await fetch(url(`/coins/${id}/history`, { date: ds, localization: 'false' }));
    if (r.status === 429 && tries < 3) { await new Promise((res) => setTimeout(res, 3000)); return historicalCHF(sym, date, tries + 1); }
    const j = await r.json();
    const v = j.market_data && j.market_data.current_price ? j.market_data.current_price.chf : null;
    histCache[key] = v ?? null;
    return histCache[key];
  } catch (e) { return null; }
}
