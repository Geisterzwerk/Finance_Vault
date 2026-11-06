// =====================================================================
// backup.js – Automatisches Server-Backup + Wiederherstellung auf neuem Gerät
//
// · Hochgeladen wird genau dasselbe Backup wie beim manuellen Export:
//   innen mit dem PIN, aussen zusätzlich mit dem Backup-Passwort verschlüsselt.
//   Der Server kann es nicht öffnen und nimmt nichts anderes an.
// · Höchstens einmal pro Tag und nur, wenn sich etwas geändert hat
//   (Kurse, Snapshots usw. zählen nicht als Änderung).
// · Der Server dünnt selbst aus (7 Tage / 5 Wochen / 12 Monate / 3 Jahre).
// · Das Backup-Passwort liegt nur im verschlüsselten Vault (für die
//   automatische Sicherung) – nie im Klartext, nie auf dem Server.
// =====================================================================
import { S, commit, flush } from './store.js';
import { exportBackup } from './vault.js';
import { isConfigured } from './server.js';

const DAY = 864e5;
const MIN_GAP = 20 * 36e5;      // höchstens ~1× täglich
const REFRESH = 14 * DAY;       // ohne Änderungen trotzdem alle 2 Wochen (frischer Beweis, dass es klappt)
// Werte, die sich ohne dein Zutun ständig ändern -> keine «Änderung»
const VOLATILE = ['prices', 'pricesAt', 'histCache', 'netSnaps', 'server', 'autoBackup', 'meta', 'market', 'ledgerStatus'];

export const abCfg = () => (S().autoBackup ||= { enabled: false, password: '', lastAt: null, lastId: '', lastFp: '', lastError: null, lastSize: 0, count: 0 });

async function fingerprint() {
  const s = S(); const o = {};
  for (const k of Object.keys(s).sort()) if (!VOLATILE.includes(k)) o[k] = s[k];
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(o)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const base = () => S().server.url.replace(/\/$/, '');
async function call(url, token, opts = {}, timeout = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || (r.status === 413 ? 'Backup zu gross für den Server (FV_BACKUP_MAX_MB)' : 'HTTP ' + r.status)); }
    return r;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('Server nicht erreichbar (Tailscale an?)');
    throw e;
  } finally { clearTimeout(t); }
}

// Fällig? (aktiviert, Server gekoppelt, > 20 h seit letzter Sicherung, etwas geändert oder 2 Wochen vorbei)
export async function due() {
  const c = abCfg();
  if (!c.enabled || !c.password || !isConfigured() || !navigator.onLine) return false;
  const since = c.lastAt ? Date.now() - new Date(c.lastAt).getTime() : Infinity;
  if (since < MIN_GAP) return false;
  return since > REFRESH || (await fingerprint()) !== c.lastFp;
}

let running = null;
export function backupNow({ quiet = false, force = false } = {}) {
  if (running) return running;
  running = (async () => {
    const c = abCfg();
    if (!c.password) throw new Error('Zuerst Backup-Passwort festlegen');
    if (!isConfigured()) throw new Error('Server nicht gekoppelt');
    const fp = await fingerprint();
    if (!force && fp === c.lastFp && c.lastAt && Date.now() - new Date(c.lastAt).getTime() < 36e5) return { ok: true, unchanged: true, id: c.lastId };
    await flush();                                   // aktuellen Stand verschlüsselt speichern
    const text = await exportBackup(c.password);
    const size = text.length;
    const r = await (await call(base() + '/api/backup', S().server.token, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }, 30000 + size / 50)).json();
    Object.assign(c, { lastAt: new Date().toISOString(), lastId: r.id, lastFp: fp, lastError: null, lastSize: size, count: r.count || c.count });
    S().meta.lastServerBackup = c.lastAt;
    commit(true);
    return r;
  })().catch((e) => {
    const c = abCfg(); c.lastError = { at: new Date().toISOString(), msg: e.message }; commit(true);
    if (!quiet) throw e;
    return null;
  }).finally(() => { running = null; });
  return running;
}

// Automatisch (nach dem Entsperren / Sync), still im Hintergrund
export async function autoBackup() {
  try { if (await due()) return await backupNow({ quiet: true }); } catch (e) { /* still */ }
  return null;
}

export async function listBackups() {
  return (await call(base() + '/api/backups', S().server.token)).json();
}
export async function downloadBackup(id = 'latest') {
  return (await call(base() + '/api/backup/' + encodeURIComponent(id), S().server.token, {}, 180000)).text();
}

// ---------- Wiederherstellung auf einem neuen Gerät (noch kein Vault) ----------
// 1) Mit Kopplungscode ein neues Token holen  2) neuestes Backup laden
// Das neue Token wird bis nach dem Entsperren in sessionStorage gehalten und dann
// in den Vault übernommen; das Token des alten Geräts wird dabei widerrufen.
const PENDING = 'fv-restore-server';
export async function restoreFromServer(url, code) {
  url = String(url || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error('Adresse muss mit https:// beginnen');
  let r;
  try {
    r = await fetch(url + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: String(code || '').trim(), name: 'iPhone (wiederhergestellt)' }) });
  } catch (e) { throw new Error('Server nicht erreichbar (Tailscale an?)'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(j.error || 'Kopplung fehlgeschlagen');
  const res = await call(url + '/api/backup/latest', j.token, {}, 180000).catch((e) => { throw new Error(/kein Backup/.test(e.message) ? 'Auf dem Server liegt noch kein Backup' : e.message); });
  const text = await res.text();
  try { sessionStorage.setItem(PENDING, JSON.stringify({ url, token: j.token })); } catch (e) { /* dann bleibt das alte Token */ }
  return text;
}
export const dropPending = () => { try { sessionStorage.removeItem(PENDING); } catch (e) { /* egal */ } };

// Nach dem ersten Entsperren: neues Token übernehmen, altes (vom verlorenen Gerät) widerrufen
export async function adoptPendingServer() {
  let p; try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) { p = null; }
  if (!p || !p.token) return false;
  dropPending();
  const s = S(); const old = s.server || {};
  if (old.token && old.token !== p.token && old.url) {
    try { await call(old.url.replace(/\/$/, '') + '/api/unpair', old.token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 6000); } catch (e) { /* altes Token schon ungültig */ }
  }
  s.server = { ...old, url: p.url, token: p.token, push: false, lastReminders: '' };
  commit(true);
  return true;
}
