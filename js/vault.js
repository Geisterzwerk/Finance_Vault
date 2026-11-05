// =====================================================================
// vault.js – Verschlüsselter Speicher
// IndexedDB + Web Crypto: PIN -> PBKDF2 -> AES-GCM-Schlüssel
// Alle Daten (inkl. Dateien) liegen nur verschlüsselt auf dem Gerät.
// =====================================================================

const DB_NAME = 'financevault';
const STORE = 'kv';
const ITER = 250000;
const enc = new TextEncoder();
const dec = new TextDecoder();

let dbp = null;
let KEY = null; // CryptoKey, nur im Arbeitsspeicher

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const st = tx.objectStore(STORE);
    const req = fn(st);
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}
export const idbGet = (k) => idb('readonly', (s) => s.get(k));
export const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));
export const idbDel = (k) => idb('readwrite', (s) => s.delete(k));
export const idbKeys = () => idb('readonly', (s) => s.getAllKeys());

function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encryptBytes(bytes, key = KEY) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv), ct };
}
async function decryptBytes(obj, key = KEY) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, obj.ct);
}

// ---------- Öffentliche API ----------
export async function isSetUp() { return !!(await idbGet('meta')); }
export const isUnlocked = () => !!KEY;
export function lock() { KEY = null; }

export async function setup(pin, initialState) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  KEY = await deriveKey(pin, salt);
  await idbSet('meta', { salt: b64(salt), version: 1, created: new Date().toISOString() });
  await saveState(initialState);
}

export async function unlock(pin) {
  const meta = await idbGet('meta');
  const key = await deriveKey(pin, unb64(meta.salt));
  const blob = await idbGet('vault');
  try {
    const plain = await decryptBytes(blob, key);
    KEY = key;
    return JSON.parse(dec.decode(plain));
  } catch (e) {
    return null; // falscher PIN
  }
}

export async function changePin(oldPin, newPin, state) {
  const ok = await unlock(oldPin);
  if (!ok) return false;
  // Dateien mit neuem Schlüssel neu verschlüsseln
  const files = {};
  for (const k of await idbKeys()) if (String(k).startsWith('file:')) files[k] = await readFileRaw(k);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  KEY = await deriveKey(newPin, salt);
  await idbSet('meta', { salt: b64(salt), version: 1, created: new Date().toISOString() });
  await saveState(state);
  for (const [k, f] of Object.entries(files)) await writeFileRaw(k, f.bytes, f.type, f.name);
  return true;
}

export async function saveState(state) {
  if (!KEY) throw new Error('Vault gesperrt');
  await idbSet('vault', await encryptBytes(enc.encode(JSON.stringify(state))));
}

// ---------- Dateien (PDFs, Fotos) ----------
async function writeFileRaw(key, bytes, type, name) {
  const e = await encryptBytes(bytes);
  await idbSet(key, { ...e, type, name });
}
async function readFileRaw(key) {
  const f = await idbGet(key);
  if (!f) return null;
  return { bytes: await decryptBytes(f), type: f.type, name: f.name };
}
export async function putFile(id, file) {
  await writeFileRaw('file:' + id, await file.arrayBuffer(), file.type, file.name);
}
export async function getFileURL(id) {
  const f = await readFileRaw('file:' + id);
  return f ? URL.createObjectURL(new Blob([f.bytes], { type: f.type })) : null;
}
export const deleteFile = (id) => idbDel('file:' + id);

// ---------- Backup (bleibt verschlüsselt, nur mit PIN lesbar) ----------
export async function exportBackup() {
  const out = { app: 'FinanceVault', version: 1, exported: new Date().toISOString(), entries: {} };
  for (const k of await idbKeys()) {
    const v = await idbGet(k);
    out.entries[k] = v && v.ct ? { ...v, ct: b64(v.ct) } : v;
  }
  return JSON.stringify(out);
}
export async function importBackup(text) {
  const data = JSON.parse(text);
  if (data.app !== 'FinanceVault') throw new Error('Keine Finance-Vault-Sicherung');
  for (const k of await idbKeys()) await idbDel(k);
  for (const [k, v] of Object.entries(data.entries)) await idbSet(k, v && v.ct ? { ...v, ct: unb64(v.ct).buffer } : v);
  KEY = null;
}

export async function wipeAll() {
  for (const k of await idbKeys()) await idbDel(k);
  KEY = null;
}
