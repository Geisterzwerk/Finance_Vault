// =====================================================================
// server.js – Verbindung zum eigenen Finance-Vault-Server (Tailscale)
// · Kopplung mit einmaligem Code -> Token (verschlüsselt im Vault)
// · Push-Mitteilungen abonnieren
// · Erinnerungstermine übertragen (nur Termine und neutrale Texte)
// · BingX-Trades abholen und als Transaktionen übernehmen
// Ohne Verbindung läuft die App normal weiter (letzter Stand).
// =====================================================================
import { S, commit, uid } from './store.js';
import { historicalCHF, coinId } from './prices.js';
import { holdings, hiddenAssets } from './calc.js';
import { applyFunding, autoResolve, updateSecurities } from './auto.js';
import { reminderDates as taxReminders } from './taxcal.js';

const cfg = () => (S().server ||= { url: '', token: '', lastSync: null, lastReminders: '', push: false, status: null });
export const isConfigured = () => !!(cfg().url && cfg().token);

async function api(path, { method = 'GET', body, auth = true, timeout = 8000 } = {}) {
  const c = cfg();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(c.url.replace(/\/$/, '') + path, {
      method, signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + c.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Server nicht erreichbar (Tailscale an?)');
    if (e instanceof TypeError) throw new Error('Server nicht erreichbar (Tailscale an?)');
    throw e;
  } finally { clearTimeout(t); }
}

export async function health(url) {
  const c = cfg(); const old = c.url; c.url = url;
  try { return await api('/api/health', { auth: false }); } finally { c.url = old; }
}

export async function pair(url, code) {
  const c = cfg();
  url = url.trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error('Adresse muss mit https:// beginnen');
  const h = await health(url);
  c.url = url;
  const r = await api('/api/pair', { method: 'POST', body: { code, name: 'iPhone' }, auth: false });
  c.token = r.token; c.vapid = h.vapidPublicKey; c.bingx = h.bingx;
  commit();
  return h;
}

// Trennen: Token auf dem Server widerrufen (falls erreichbar), dann lokal löschen
export async function unpair() {
  try { if (isConfigured()) await api('/api/unpair', { method: 'POST', body: {}, timeout: 5000 }); } catch (e) { /* offline: lokal trotzdem trennen */ }
  try { const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* egal */ }
  const s = S(); s.server = { url: '', token: '', lastSync: null, lastReminders: '', push: false, status: null }; commit();
}

// ---------- Push ----------
const b64ToBytes = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push nur in der Home-Bildschirm-App (iOS 16.4+) möglich');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Mitteilungen nicht erlaubt (iPhone-Einstellungen › Mitteilungen)');
  const c = cfg();
  if (!c.vapid) c.vapid = (await api('/api/health', { auth: false })).vapidPublicKey;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(c.vapid) });
  await api('/api/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  c.push = true; commit();
}
export const testPush = () => api('/api/test-push', { method: 'POST', body: {} });

// ---------- Erinnerungen (nur Termine, keine Beträge) ----------
const at = (y, m, d, h = 9, min = 0) => new Date(y, m, d, h, min).getTime();
export function buildReminders() {
  const s = S(); const now = new Date(); const y = now.getFullYear(); const list = [];
  const add = (id, time, title, body, url) => { if (time > Date.now() - 864e5) list.push({ id, at: time, title, body, url }); };
  for (const yy of [y, y + 1]) {
    add(`ye-${yy}`, at(yy, 11, 31, 18), 'Jahresabschluss', `Zeit für den Finance-Vault-Jahresabschluss ${yy}.`, './#/steuern');
    add(`ye2-${yy}`, at(yy + 1, 0, 2, 10), 'Jahresabschluss offen?', 'Daten aktualisieren und Steuerunterlagen erstellen.', './#/steuern');
    add(`docs-${yy + 1}`, at(yy + 1, 0, 20, 18), 'Steuerdokumente', 'Lohnausweis, 3a und Bank-Steuerauszüge sind meist da – einscannen?', './#/vault/inbox');
  }
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, now.getMonth() + i, 1, 18);
    add(`mon-${d.getFullYear()}-${d.getMonth() + 1}`, d.getTime(), 'Monats-Update', 'BingX/Relai importieren und Kontostände aktualisieren.', './#/vault');
  }
  // Steuerfristen (Erklärung, Bund, Staat, Gemeinde) – 14 und 3 Tage vorher, am Tag selbst
  for (const r of taxReminders()) add(r.id, r.at, r.title, r.body, './#/steuern');
  for (const inv of s.invoices) {
    if (inv.status !== 'open' || !inv.due) continue;
    if (inv.category === 'Steuern') continue; // kommen über den Steuerkalender
    const [Y, M, D] = inv.due.split('-').map(Number);
    const tax = false;
    for (const [k, off, txt] of [['7', -7, 'in 7 Tagen'], ['2', -2, 'in 2 Tagen'], ['0', 0, 'heute']]) {
      add(`inv-${inv.id}-${k}`, at(Y, M - 1, D + off, 9), tax ? 'Steuerzahlung fällig' : 'Rechnung fällig', `Eine ${tax ? 'Steuerrechnung' : 'Rechnung'} ist ${txt} fällig.`, './#/rechnungen');
    }
  }
  return list;
}
export async function syncReminders(force = false) {
  const items = buildReminders(); const sig = JSON.stringify(items.map((i) => i.id + i.at));
  if (!force && sig === cfg().lastReminders) return { skipped: true };
  await api('/api/reminders', { method: 'PUT', body: { items } });
  cfg().lastReminders = sig; commit(true);
  return { count: items.length };
}

// ---------- BingX-Trades übernehmen ----------
// Nur Trades NACH dem Ende des letzten Kontoauszugs, damit nichts doppelt zählt.
const statementCutoff = () => { const im = S().imports.BingX; return im ? (im.toMs || (im.to ? new Date(String(im.to).replace(' ', 'T')).getTime() : 0)) : 0; };
async function applyTrades(trades) {
  const s = S(); const cutoff = statementCutoff();
  const have = new Set(s.transactions.map((t) => t.extId));
  const deleted = s.deletedExt || {}; const hidden = hiddenAssets();
  const sym = (x) => /^[A-Z0-9]{1,20}$/.test(String(x || ''));
  const pos = (x) => Number.isFinite(+x) && +x >= 0;
  let added = 0;
  for (const t of Array.isArray(trades) ? trades : []) {
    // Server-Daten nie blind vertrauen
    if (!t || !sym(t.base) || !sym(t.quote) || !pos(t.qty) || !pos(t.quoteQty) || !pos(t.fee) || !Number.isFinite(+t.time)) continue;
    const id = 'bingxapi:' + t.id; if (have.has(id) || deleted[id] || t.time <= cutoff || hidden.has(t.base)) continue;
    const date = new Date(t.time).toISOString();
    const rate = await historicalCHF(t.quote, date);
    const chf = rate != null && t.quoteQty ? +(t.quoteQty * rate).toFixed(2) : null;
    const buy = t.side === 'BUY';
    const feeInBase = t.feeAsset === t.base ? t.fee : 0;
    s.transactions.push(
      { id: uid(), extId: id, type: buy ? 'buy' : 'sell', asset: t.base, amount: buy ? t.qty - feeInBase : t.qty, chf, fee: 0, date, platform: 'BingX', note: `BingX-API: ${t.quoteQty} ${t.quote}` },
      { id: uid(), extId: id + ':q', type: buy ? 'sell' : 'buy', asset: t.quote, amount: buy ? t.quoteQty : t.quoteQty - (t.feeAsset === t.quote ? t.fee : 0), chf, fee: 0, date, platform: 'BingX', note: `Gegenseite ${t.base}` },
    );
    added++;
  }
  return added;
}
// Älterer Server (v1) – nur Trades
export async function syncBingx() {
  const c = cfg();
  const r = await api('/api/bingx/trades?since=' + statementCutoff(), { timeout: 15000 });
  const added = await applyTrades(r.trades);
  c.bingxLast = r.lastSync; c.bingxError = r.lastError;
  commit(!added);
  return { added, error: r.lastError };
}

// ---------- Beobachtungsliste an den Server ----------
// Nur: Coin-Kürzel + Kurs-Id, Aktien-Ticker, öffentliche Adressen. Keine Mengen, keine Werte.
export function buildWatch() {
  const s = S(); const hidden = hiddenAssets(); const coins = {};
  const syms = new Set([...Object.keys(holdings()), ...s.goals.filter((g) => g.kind === 'asset' && g.asset).map((g) => g.asset)]);
  for (const sym of syms) if (!hidden.has(sym) && /^[A-Z0-9]{1,20}$/.test(sym) && !['CHF', 'USD', 'EUR'].includes(sym)) coins[sym] = coinId(sym) || '';
  const tickers = [...new Set(s.accounts.flatMap((a) => (a.positions || []).map((p) => p.ticker)).filter(Boolean))];
  const addresses = s.settings.ledgerViaServer === false ? [] : (s.ledger.addresses || []).map((a) => ({ chain: a.chain, address: a.address }));
  return { coins, tickers, addresses };
}
async function pushWatch(force = false) {
  const w = buildWatch(); const sig = JSON.stringify(w);
  if (!force && sig === cfg().watchSig) return false;
  await api('/api/watch', { method: 'PUT', body: w });
  cfg().watchSig = sig; return true;
}

// ---------- Alles vom Server holen ----------
const DAYMS = 864e5;
async function pullSync() {
  const s = S(); const c = cfg();
  const q = `/api/sync?since=${c.syncSince || 0}&histFrom=${encodeURIComponent(c.histFrom || '')}`;
  const r = await api(q, { timeout: 20000 });
  const res = { prices: 0, trades: 0, funding: 0, auto: 0, ledger: false };
  const mk = r.market || {};
  // Namen/Ids neu gefundener Coins (automatisch – bis zur Bestätigung nicht für Meilensteine)
  for (const [sym, n] of Object.entries(mk.names || {})) if (n && n.id && !coinId(sym)) s.coins[sym] = { ...(s.coins[sym] || {}), id: n.id, name: n.name, auto: true };
  for (const [sym, p] of Object.entries(mk.coins || {})) {
    if (!p || !(p.chf > 0)) continue;
    s.prices[sym] = { chf: p.chf, change24h: p.ch24 ?? null, at: new Date(p.at).toISOString(), src: 'server' }; res.prices++;
  }
  s.stockPrices = s.stockPrices || {};
  for (const [t, p] of Object.entries(mk.stocks || {})) if (p && p.chf > 0) s.stockPrices[t] = { chf: p.chf, price: p.price, currency: p.currency, name: p.name, change24h: p.ch24 ?? null, at: new Date(p.at).toISOString() };
  if (res.prices) s.pricesAt = new Date(mk.at || Date.now()).toISOString();
  // Kursverläufe in den Zwischenspeicher (Tag -> Mittag UTC)
  const H = r.history || {};
  for (const [sym, days] of Object.entries(H.coins || {})) {
    const id = coinId(sym); if (!id) continue;
    const cur = new Map(((s.histCache[id] || {}).p || []).map(([ms, v]) => [new Date(ms).toISOString().slice(0, 10), [ms, v]]));
    for (const [d, v] of Object.entries(days)) if (v > 0) cur.set(d, [Date.parse(d + 'T12:00:00Z'), v]);
    s.histCache[id] = { at: Date.now(), p: [...cur.values()].sort((x, y) => x[0] - y[0]), src: 'server' };
  }
  s.stockHist = s.stockHist || {};
  for (const [t, days] of Object.entries(H.stocks || {})) s.stockHist[t] = { ...(s.stockHist[t] || {}), ...days };
  // Ledger
  const L = r.ledger || {};
  if (L.at) { s.ledger.last = { total: L.total || {}, errors: (L.errors || []).map((e) => ({ chain: e.chain, address: e.address, error: e.error })), at: new Date(L.at).toISOString(), src: 'server' }; res.ledger = true; }
  // BingX
  const bx = r.bingx || {};
  if (bx.configured) {
    res.trades = await applyTrades(bx.trades);
    const f = await applyFunding({ deposits: bx.deposits || [], withdrawals: bx.withdrawals || [] }, statementCutoff());
    res.funding = f.added; res.auto = f.auto;
    if (bx.balances && bx.balances.assets) s.server.bxBalances = { at: bx.balances.at, assets: bx.balances.assets };
    c.bingxLast = bx.lastSync; c.bingxError = bx.lastError;
  } else res.auto = await autoResolve();
  updateSecurities();
  c.syncSince = r.time; c.histFrom = new Date(r.time - DAYMS).toISOString().slice(0, 10);
  c.market = { at: mk.at, error: mk.error }; c.version = r.version;
  return res;
}

// ---------- Alles abgleichen (beim Öffnen, regelmässig, auf Knopfdruck) ----------
let running = false;
export async function syncAll({ quiet = true, force = false } = {}) {
  if (!isConfigured() || running || !navigator.onLine) return null;
  running = true; const c = cfg();
  try {
    const rem = await syncReminders();
    let out;
    try { await pushWatch(force); out = await pullSync(); }
    catch (e) {
      if (!/unbekannt|404/.test(e.message)) throw e;
      out = { legacy: true, ...(await syncBingx()) }; // Server noch v1
    }
    c.lastSync = new Date().toISOString();
    c.status = { ok: true, msg: c.bingxError ? 'BingX: ' + c.bingxError : c.market && c.market.error ? 'Kurse: ' + c.market.error : 'verbunden' };
    commit();
    return { rem, ...out };
  } catch (e) {
    c.status = { ok: false, msg: e.message }; commit(true);
    if (!quiet) throw e;
    return null;
  } finally { running = false; }
}
export const refreshLedger = () => api('/api/ledger/refresh', { method: 'POST', body: {} });
export const triggerBingx = () => api('/api/bingx/sync', { method: 'POST', body: {}, timeout: 120000 });
