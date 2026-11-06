// =====================================================================
// vault.js – Verschlüsselter Speicher
// IndexedDB + Web Crypto: PIN -> PBKDF2-SHA256 -> AES-GCM-256
// Alle Daten (inkl. Dateien) liegen nur verschlüsselt auf dem Gerät.
//
// · Der Schlüssel ist nicht exportierbar und lebt nur im Arbeitsspeicher.
// · Jede Verschlüsselung nutzt einen neuen, zufälligen IV (96 Bit).
// · Ältere Vaults (250'000 Iterationen) werden beim Entsperren automatisch
//   auf ITER umgeschlüsselt – in EINER IndexedDB-Transaktion (alles oder nichts).
// · Falsche PIN-Eingaben bremsen exponentiell (gegen Durchprobieren).
// · Backups: zusätzlich mit separatem Backup-Passwort verschlüsselt.
// =====================================================================

const DB_NAME = 'financevault';
const STORE = 'kv';
const ITER = 600000;          // OWASP-Empfehlung 2023 für PBKDF2-SHA256
const LEGACY_ITER = 250000;   // Vaults bis v2.2
const BACKUP_ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

let dbp = null;
let KEY = null; // CryptoKey, nur im Arbeitsspeicher, nicht exportierbar

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaktion abgebrochen'));
  });
}
export const idbGet = (k) => idb('readonly', (s) => s.get(k));
export const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));
export const idbDel = (k) => idb('readwrite', (s) => s.delete(k));
export const idbKeys = () => idb('readonly', (s) => s.getAllKeys());
// Mehrere Einträge atomar schreiben (optional vorher alles löschen)
const idbWriteAll = (entries, clearFirst = false) => idb('readwrite', (s) => {
  if (clearFirst) s.clear();
  for (const [k, v] of entries) s.put(v, k);
  return null;
});

function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(secret, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptBytes(bytes, key = KEY) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes) };
}
const decryptBytes = (obj, key = KEY) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, obj.ct);
const iterOf = (meta) => meta.iter || LEGACY_ITER;
const newMeta = (salt) => ({ salt: b64(salt), iter: ITER, version: 2, created: new Date().toISOString() });

// ---------- Bremse gegen Durchprobieren ----------
// Nach 5 Fehlversuchen: 30 s, danach jeweils doppelt so lange (max. 1 h).
const GUARD = 'guard';
export async function lockoutRemaining() {
  const g = (await idbGet(GUARD)) || { fails: 0, until: 0 };
  return Math.max(0, g.until - Date.now());
}
async function registerFail() {
  const g = (await idbGet(GUARD)) || { fails: 0, until: 0 };
  g.fails += 1;
  if (g.fails >= 5) g.until = Date.now() + Math.min(3600e3, 30e3 * 2 ** (g.fails - 5));
  await idbSet(GUARD, g);
}

// ---------- Öffentliche API ----------
export async function isSetUp() { return !!(await idbGet('meta')); }
export const isUnlocked = () => !!KEY;
export function lock() { KEY = null; }

export async function setup(pin, initialState) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt, ITER);
  const vault = await encryptBytes(enc.encode(JSON.stringify(initialState)), key);
  await idbWriteAll([['meta', newMeta(salt)], ['vault', vault]]);
  KEY = key;
}

// Liefert den Zustand oder null (falscher PIN). Wirft bei aktiver Sperre.
export async function unlock(pin) {
  const wait = await lockoutRemaining();
  if (wait > 0) { const e = new Error('locked'); e.wait = wait; throw e; }
  const meta = await idbGet('meta');
  const key = await deriveKey(pin, unb64(meta.salt), iterOf(meta));
  let state;
  try { state = JSON.parse(dec.decode(await decryptBytes(await idbGet('vault'), key))); } catch (e) { await registerFail(); return null; }
  await idbDel(GUARD);
  KEY = key;
  if (iterOf(meta) < ITER) { try { await rekey(pin, pin, state); } catch (e) { console.warn('Umschlüsseln fehlgeschlagen', e); } }
  return state;
}

// Alles mit neuem Salt/Schlüssel neu verschlüsseln – atomar.
async function rekey(oldPin, newPin, state) {
  const meta = await idbGet('meta');
  const oldKey = await deriveKey(oldPin, unb64(meta.salt), iterOf(meta));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(newPin, salt, ITER);
  const out = [['meta', newMeta(salt)], ['vault', await encryptBytes(enc.encode(JSON.stringify(state)), newKey)]];
  for (const k of await idbKeys()) {
    if (!String(k).startsWith('file:')) continue;
    const f = await idbGet(k);
    const bytes = await decryptBytes(f, oldKey); // wirft bei Fehler -> nichts wird geschrieben
    out.push([k, { ...(await encryptBytes(bytes, newKey)), type: f.type, name: f.name }]);
  }
  await idbWriteAll(out);
  KEY = newKey;
}

export async function changePin(oldPin, newPin, state) {
  const meta = await idbGet('meta');
  const key = await deriveKey(oldPin, unb64(meta.salt), iterOf(meta));
  try { await decryptBytes(await idbGet('vault'), key); } catch (e) { await registerFail(); return false; }
  await rekey(oldPin, newPin, state);
  return true;
}

export async function saveState(state) {
  if (!KEY) throw new Error('Vault gesperrt');
  await idbSet('vault', await encryptBytes(enc.encode(JSON.stringify(state))));
}

// ---------- Dateien (PDFs, Fotos) ----------
async function writeFileRaw(key, bytes, type, name) { await idbSet(key, { ...(await encryptBytes(bytes)), type, name }); }
async function readFileRaw(key) {
  const f = await idbGet(key);
  return f ? { bytes: await decryptBytes(f), type: f.type, name: f.name } : null;
}
export async function putFile(id, file) { await writeFileRaw('file:' + id, await file.arrayBuffer(), file.type, file.name); }

// Nur «passive» Formate werden im Browser geöffnet. HTML, SVG, XML usw.
// könnten Skripte im Ursprung der App ausführen (gespeichertes XSS über
// einen präparierten Beleg) – sie werden nur als Download angeboten.
const SAFE_VIEW = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'text/plain'];
export const safeType = (t) => (SAFE_VIEW.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : 'application/octet-stream');
export async function getFileURL(id) {
  const f = await readFileRaw('file:' + id);
  if (!f) return null;
  const url = URL.createObjectURL(new Blob([f.bytes], { type: safeType(f.type) }));
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60e3);
  return url;
}
export const deleteFile = (id) => idbDel('file:' + id);
export async function getFileBytes(id) {
  const f = await readFileRaw('file:' + id);
  return f ? { bytes: new Uint8Array(f.bytes), type: f.type, name: f.name } : null;
}

// ---------- Backup ----------
// Format 2: Der komplette (PIN-verschlüsselte) Vault wird zusätzlich mit einem
// separaten Backup-Passwort verschlüsselt. Grund: Ein kurzer PIN lässt sich bei
// einer gestohlenen Backup-Datei offline schnell durchprobieren.
async function rawExport() {
  const out = { app: 'FinanceVault', version: 1, exported: new Date().toISOString(), entries: {} };
  for (const k of await idbKeys()) {
    if (k === GUARD) continue;
    const v = await idbGet(k);
    out.entries[k] = v && v.ct ? { ...v, ct: b64(v.ct) } : v;
  }
  return out;
}
export async function exportBackup(password) {
  if (!password || password.length < 10) throw new Error('Backup-Passwort: mindestens 10 Zeichen');
  const inner = enc.encode(JSON.stringify(await rawExport()));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, BACKUP_ITER);
  const { iv, ct } = await encryptBytes(inner, key);
  return JSON.stringify({ app: 'FinanceVault', version: 2, exported: new Date().toISOString(), kdf: 'PBKDF2-SHA256', iter: BACKUP_ITER, salt: b64(salt), iv, ct: b64(ct) });
}

export function backupInfo(text) {
  let d; try { d = JSON.parse(text); } catch (e) { throw new Error('Keine gültige Backup-Datei'); }
  if (!d || d.app !== 'FinanceVault') throw new Error('Keine Finance-Vault-Sicherung');
  return { version: d.version, needsPassword: d.version === 2, exported: d.exported };
}

// Prüft Backup-Passwort UND PIN des Backups, bevor irgendetwas ersetzt wird.
// Danach wird alles in einer einzigen Transaktion ersetzt.
export async function importBackup(text, { password = '', pin = '' } = {}) {
  let data = JSON.parse(text);
  if (data.app !== 'FinanceVault') throw new Error('Keine Finance-Vault-Sicherung');
  if (data.version === 2) {
    const key = await deriveKey(password, unb64(data.salt), data.iter || BACKUP_ITER);
    try { data = JSON.parse(dec.decode(await decryptBytes({ iv: data.iv, ct: unb64(data.ct).buffer }, key))); } catch (e) { throw new Error('Backup-Passwort falsch'); }
  }
  const E = data.entries || {};
  if (!E.meta || !E.vault) throw new Error('Backup unvollständig');
  const entries = Object.entries(E).filter(([k]) => k !== GUARD).map(([k, v]) => [k, v && v.ct ? { ...v, ct: unb64(v.ct).buffer } : v]);
  const vault = entries.find(([k]) => k === 'vault')[1];
  const key = await deriveKey(pin, unb64(E.meta.salt), iterOf(E.meta));
  try { await decryptBytes(vault, key); } catch (e) { throw new Error('PIN des Backups falsch'); }
  await idbWriteAll(entries, true);
  KEY = null;
}
export async function wipeAll() { await idbWriteAll([], true); KEY = null; }
