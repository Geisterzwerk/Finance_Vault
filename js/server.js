// =====================================================================
// server.js – Verbindung zum eigenen Finance-Vault-Server (Tailscale)
// · Kopplung mit einmaligem Code -> Token (verschlüsselt im Vault)
// · Push-Mitteilungen abonnieren
// · Erinnerungstermine übertragen (nur Termine und neutrale Texte)
// · BingX-Trades abholen und als Transaktionen übernehmen
// Ohne Verbindung läuft die App normal weiter (letzter Stand).
// =====================================================================
import { S, commit, uid } from './store.js';
import { historicalCHF } from './prices.js';

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

export function unpair() { const s = S(); s.server = { url: '', token: '', lastSync: null, lastReminders: '', push: false, status: null }; commit(); }

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
  for (const inv of s.invoices) {
    if (inv.status !== 'open' || !inv.due) continue;
    const [Y, M, D] = inv.due.split('-').map(Number);
    const tax = inv.category === 'Steuern';
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
export async function syncBingx() {
  const s = S(); const c = cfg();
  const cutoff = s.imports.BingX && s.imports.BingX.to ? new Date(String(s.imports.BingX.to).replace(' ', 'T')).getTime() : 0;
  const r = await api('/api/bingx/trades?since=' + cutoff, { timeout: 15000 });
  const have = new Set(s.transactions.map((t) => t.extId));
  let added = 0;
  for (const t of r.trades) {
    const id = 'bingxapi:' + t.id; if (have.has(id) || t.time <= cutoff) continue;
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
  c.bingxLast = r.lastSync; c.bingxError = r.lastError;
  commit(!added);
  return { added, error: r.lastError };
}

// ---------- Alles abgleichen (beim Öffnen) ----------
let running = false;
export async function syncAll({ quiet = true } = {}) {
  if (!isConfigured() || running || !navigator.onLine) return null;
  running = true; const c = cfg();
  try {
    const rem = await syncReminders();
    const bx = c.bingx === false ? { added: 0 } : await syncBingx().catch((e) => ({ added: 0, error: e.message }));
    c.lastSync = new Date().toISOString(); c.status = { ok: true, msg: bx.error ? 'BingX: ' + bx.error : 'verbunden' };
    commit(true);
    return { rem, bx };
  } catch (e) {
    c.status = { ok: false, msg: e.message }; commit(true);
    if (!quiet) throw e;
    return null;
  } finally { running = false; }
}
export const triggerBingx = () => api('/api/bingx/sync', { method: 'POST', body: {}, timeout: 120000 });
